import { describe, expect, test } from 'vitest';
import { DEFAULT_PARAMS } from '../src/params';
import { computeLevels, positionSize, rMultiple } from '../src/risk/levels';

const R = DEFAULT_PARAMS.risk;

describe('computeLevels', () => {
  test('long from a demand zone: entry at top, SL below bottom + buffer, TP1 1.5R, TP2 2R', () => {
    const lv = computeLevels({ direction: 'long', zone: { type: 'demand', top: 4592.1, bottom: 4588.4 }, atr: 5 }, R);
    expect(lv.buffer).toBe(0.5); // max(0.1 × 5, 0.30)
    expect(lv).toMatchObject({ entry: 4592.1, stopLoss: 4587.9, riskPts: 4.2 });
    expect(lv.tp1).toBeCloseTo(4592.1 + 1.5 * 4.2, 2);
    expect(lv.tp2).toBeCloseTo(4592.1 + 2 * 4.2, 2);
    expect((lv.tp1 - lv.entry) / (lv.entry - lv.stopLoss)).toBeCloseTo(1.5, 6);
    expect((lv.tp2 - lv.entry) / (lv.entry - lv.stopLoss)).toBeCloseTo(2, 6);
  });

  test('short from a supply zone with the minimum buffer when ATR is small', () => {
    const lv = computeLevels({ direction: 'short', zone: { type: 'supply', top: 100, bottom: 99 }, atr: 1 }, R);
    expect(lv.buffer).toBe(0.3);
    expect(lv).toEqual({ entry: 99, stopLoss: 100.3, tp1: 97.05, tp2: 96.4, riskPts: 1.3, buffer: 0.3 });
  });

  test('all levels are rounded to 0.01', () => {
    const lv = computeLevels({ direction: 'long', zone: { type: 'demand', top: 100.004, bottom: 99.337 }, atr: 1.234 }, R);
    for (const v of [lv.entry, lv.stopLoss, lv.tp1, lv.tp2, lv.riskPts]) {
      expect(Math.round(v * 100) / 100).toBe(v);
    }
  });

  test('rejects mismatched direction and bad ATR', () => {
    expect(() => computeLevels({ direction: 'short', zone: { type: 'demand', top: 100, bottom: 99 }, atr: 1 }, R)).toThrow(RangeError);
    expect(() => computeLevels({ direction: 'long', zone: { type: 'demand', top: 100, bottom: 99 }, atr: 0 }, R)).toThrow(RangeError);
  });
});

describe('rMultiple & positionSize', () => {
  test('R multiple is signed by direction', () => {
    expect(rMultiple('long', 100, 2, 103)).toBe(1.5);
    expect(rMultiple('short', 100, 2, 103)).toBe(-1.5);
  });

  test('position size for 1% of 10,000 with 4.2 points of risk', () => {
    const ps = positionSize({ accountSize: 10_000, riskPercent: 1, riskPts: 4.2 }, R);
    expect(ps.riskAmount).toBe(100);
    expect(ps.lots).toBe(0.23); // 100 / (4.2 × 100) = 0.238 → floored
  });
});
