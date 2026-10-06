import { describe, expect, test } from 'vitest';
import { atr, lastAtr, trueRange } from '../src/indicators/atr';
import { bars, flat } from './fixtures';

describe('trueRange', () => {
  test('uses high-low when there is no previous candle', () => {
    const [c] = bars([[10, 12, 9, 11]]);
    expect(trueRange(c!, undefined)).toBe(3);
  });
  test('accounts for gaps against the previous close', () => {
    const [prev, cur] = bars([
      [10, 10.5, 9.5, 10],
      [13, 13.5, 12.5, 13],
    ]);
    expect(trueRange(cur!, prev)).toBeCloseTo(3.5); // |high - prevClose|
  });
});

describe('atr', () => {
  test('is NaN until the period is complete, then equals the simple average', () => {
    const candles = flat(14, 100, 1); // range 2 each
    const values = atr(candles, 14);
    expect(values.slice(0, 13).every(Number.isNaN)).toBe(true);
    expect(values[13]).toBeCloseTo(2);
  });
  test('applies Wilder smoothing after warm-up', () => {
    const candles = [...flat(14, 100, 1), ...bars([[100, 103, 97, 100]], Date.UTC(2025, 8, 1, 10, 14) / 1000)];
    const values = atr(candles, 14);
    // (2 * 13 + 6) / 14
    expect(values[14]).toBeCloseTo((2 * 13 + 6) / 14);
  });
  test('returns all NaN when there is not enough data', () => {
    expect(atr(flat(5, 100), 14).every(Number.isNaN)).toBe(true);
    expect(lastAtr(flat(5, 100), 14)).toBeNull();
  });
  test('rejects invalid period', () => {
    expect(() => atr(flat(5, 100), 0)).toThrow(RangeError);
  });
  test('lastAtr returns the final value', () => {
    expect(lastAtr(flat(20, 100, 1), 14)).toBeCloseTo(2);
  });
});
