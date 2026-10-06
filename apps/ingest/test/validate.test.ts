import { describe, expect, test } from 'vitest';
import { JUMP_ATR_MULTIPLE, detectPriceJumps, validateCandles } from '../src/pipeline/validate';
import { T0, series } from './fixtures';

const now = T0 + 3600;

describe('validateCandles', () => {
  test('accepts valid bars and sorts ascending', () => {
    const input = series(3);
    const result = validateCandles([input[2], input[0], input[1]], { nowSec: now });
    expect(result.candles.map((c) => c.time)).toEqual(input.map((c) => c.time));
    expect(result.rejected).toHaveLength(0);
  });

  test('rejects OHLC invariant violations with a reason', () => {
    const [good] = series(1);
    const bad = { ...good!, low: good!.high + 1 };
    const result = validateCandles([bad], { nowSec: now });
    expect(result.candles).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain('low');
  });

  test('rejects bars off the minute boundary and future bars', () => {
    const [good] = series(1);
    const offGrid = { ...good!, time: good!.time + 30 };
    const future = { ...good!, time: now + 60 };
    const result = validateCandles([offGrid, future], { nowSec: now });
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.map((r) => r.reason).join(' ')).toMatch(/minute boundary/);
    expect(result.rejected.map((r) => r.reason).join(' ')).toMatch(/future/);
  });

  test('keeps the last duplicate and flags it as an anomaly', () => {
    const [a] = series(1);
    const dup = { ...a!, close: a!.close + 0.1 };
    const result = validateCandles([a, dup], { nowSec: now });
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]?.close).toBe(dup.close);
    expect(result.anomalies.filter((x) => x.kind === 'duplicate')).toHaveLength(1);
  });

  test('flags but keeps a > 5×ATR price jump', () => {
    const base = series(30); // ATR ≈ 1.0 (range 1 + small drift)
    const last = base[base.length - 1]!;
    const jump = { ...last, time: last.time + 60, open: last.close, close: last.close + 20, high: last.close + 20.5, low: last.close - 0.5 };
    const result = validateCandles([...base, jump], { nowSec: now + 7200 });
    const jumps = result.anomalies.filter((x) => x.kind === 'price_jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]?.tsSec).toBe(jump.time);
    expect(Number(jumps[0]?.detail.multiple)).toBeGreaterThan(JUMP_ATR_MULTIPLE);
    expect(result.candles).toHaveLength(31);
  });

  test('uses previous context so the first bar of a chunk is checked too', () => {
    const previous = series(30);
    const last = previous[previous.length - 1]!;
    const chunk = [{ ...last, time: last.time + 60, open: last.close, close: last.close + 20, high: last.close + 20.5, low: last.close - 0.5 }];
    expect(detectPriceJumps(chunk, previous)).toHaveLength(1);
    expect(detectPriceJumps(chunk, [])).toHaveLength(0);
  });
});
