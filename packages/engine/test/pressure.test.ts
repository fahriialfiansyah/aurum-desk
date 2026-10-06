import { describe, expect, test } from 'vitest';
import { DEFAULT_PARAMS } from '../src/params';
import { evaluatePressure } from '../src/pressure/evaluate';
import { isConsecutiveExpansion, isEngulfing, isInsideBarBreak, isPinBar, isRejectionWick } from '../src/pressure/patterns';
import { bars } from './fixtures';

const P = DEFAULT_PARAMS.pressure;
const demand = { type: 'demand', top: 100, bottom: 98 } as const;
const supply = { type: 'supply', top: 112, bottom: 110 } as const;

describe('pattern detectors', () => {
  test('rejection wick (long): lower wick ≥ 50% of range and close in upper half', () => {
    const [c] = bars([[100.5, 101, 98.5, 100.8]]); // range 2.5, lower wick 2.0
    expect(isRejectionWick(c!, 'long', P)).toBe(true);
    expect(isRejectionWick(c!, 'short', P)).toBe(false);
    const [weak] = bars([[100.5, 101, 100.3, 100.8]]); // wick 0.2 of range 0.7
    expect(isRejectionWick(weak!, 'long', P)).toBe(false);
  });

  test('engulfing', () => {
    const [prev, c] = bars([
      [100.4, 100.6, 99.6, 99.8],
      [99.7, 101.2, 99.5, 101],
    ]);
    expect(isEngulfing(prev!, c!, 'long')).toBe(true);
    expect(isEngulfing(prev!, c!, 'short')).toBe(false);
    const [p2, c2] = bars([
      [110.2, 110.9, 110, 110.8],
      [110.9, 111, 109.5, 109.8],
    ]);
    expect(isEngulfing(p2!, c2!, 'short')).toBe(true);
  });

  test('pin bar', () => {
    const [c] = bars([[100.4, 100.6, 98.4, 100.5]]); // tail 2.0 of range 2.2, body 0.1
    expect(isPinBar(c!, 'long', P)).toBe(true);
    const [bigBody] = bars([[99, 100.6, 98.4, 100.5]]);
    expect(isPinBar(bigBody!, 'long', P)).toBe(false);
  });

  test('inside bar break', () => {
    const [mother, inside, brk, noBrk] = bars([
      [100, 101, 99, 100.5],
      [100.4, 100.8, 99.6, 100.2],
      [100.2, 101.4, 100.1, 101.2],
      [100.2, 100.9, 100.1, 100.7],
    ]);
    expect(isInsideBarBreak(mother!, inside!, brk!, 'long')).toBe(true);
    expect(isInsideBarBreak(mother!, inside!, noBrk!, 'long')).toBe(false);
    expect(isInsideBarBreak(mother!, brk!, brk!, 'long')).toBe(false); // not an inside bar
  });

  test('consecutive expansion: 2+ directional closes with growing bodies', () => {
    const up = bars([
      [100, 100.3, 99.9, 100.2],
      [100.2, 100.7, 100.1, 100.6],
    ]);
    expect(isConsecutiveExpansion(up, 'long')).toBe(true);
    expect(isConsecutiveExpansion(up, 'short')).toBe(false);
    const shrinking = bars([
      [100, 100.8, 99.9, 100.7],
      [100.7, 100.9, 100.6, 100.8],
    ]);
    expect(isConsecutiveExpansion(shrinking, 'long')).toBe(false);
    expect(isConsecutiveExpansion(up.slice(1), 'long')).toBe(false);
  });
});

describe('evaluatePressure', () => {
  test('zero when price never entered the zone within the lookback', () => {
    const candles = bars([
      [104, 105, 103.5, 104.5],
      [104.5, 105.5, 104, 105],
      [105, 106, 104.8, 105.8],
    ]);
    expect(evaluatePressure(candles, demand, 'long', P)).toEqual({ score: 0, patterns: [], touched: false });
  });

  test('long: rejection + engulfing inside a demand zone, closing back above the entry', () => {
    const candles = bars([
      [101, 101.2, 100.4, 100.6],
      [100.6, 100.7, 99.2, 99.5], // bearish into the zone
      [99.4, 101.6, 97.0, 101.4], // bullish engulfing with a long lower wick (2.4 of 4.6)
    ]);
    const r = evaluatePressure(candles, demand, 'long', P);
    expect(r.touched).toBe(true);
    expect(r.patterns).toContain('engulfing');
    expect(r.patterns).toContain('rejection_wick');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  test('short: pin bar at supply', () => {
    const candles = bars([
      [109, 109.4, 108.6, 109.2],
      [109.2, 109.6, 108.9, 109.5],
      [109.5, 111.8, 109.3, 109.4], // long upper tail into supply, tiny body
    ]);
    const r = evaluatePressure(candles, supply, 'short', P);
    expect(r.patterns).toEqual(expect.arrayContaining(['pin_bar', 'rejection_wick']));
    expect(r.score).toBeGreaterThan(DEFAULT_PARAMS.minPressureScore);
  });

  test('touch without any pattern scores zero but reports the touch', () => {
    const candles = bars([
      [101, 101.5, 100.8, 101.2],
      [101.2, 101.4, 99.5, 99.6], // dives into zone and closes weak
      [99.6, 99.9, 99.1, 99.2], // keeps falling
    ]);
    const r = evaluatePressure(candles, demand, 'long', P);
    expect(r).toEqual({ score: 0, patterns: [], touched: true });
  });
});
