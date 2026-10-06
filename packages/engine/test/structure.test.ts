import { describe, expect, test } from 'vitest';
import { analyzeStructure, labelSwings } from '../src/structure/structure';
import { detectSwings } from '../src/structure/swings';
import { bars, path } from './fixtures';

const P = { left: 2, right: 2 };

describe('detectSwings', () => {
  test('finds fractal highs and lows at zig-zag pivots', () => {
    const candles = path([100, 110, 105, 115, 108], 4);
    const swings = detectSwings(candles, P);
    const highs = swings.filter((s) => s.kind === 'high').map((s) => s.index);
    const lows = swings.filter((s) => s.kind === 'low').map((s) => s.index);
    expect(highs).toEqual([3, 11]); // pivots at 110 and 115
    expect(lows).toEqual([7]); // pivot at 105 (108 is unconfirmed: last `right` candles)
    expect(swings.find((s) => s.index === 3)?.price).toBeCloseTo(110.1);
  });

  test('never returns a swing in the last `right` candles', () => {
    const candles = path([100, 110], 3);
    expect(detectSwings(candles, P)).toEqual([]);
  });

  test('rejects invalid strength', () => {
    expect(() => detectSwings([], { left: 0, right: 2 })).toThrow(RangeError);
  });
});

describe('labelSwings', () => {
  test('labels HH/HL/LH/LL relative to the previous swing of the same kind', () => {
    const labeled = labelSwings([
      { index: 0, time: 0, price: 10, kind: 'high' },
      { index: 1, time: 1, price: 5, kind: 'low' },
      { index: 2, time: 2, price: 12, kind: 'high' },
      { index: 3, time: 3, price: 7, kind: 'low' },
      { index: 4, time: 4, price: 11, kind: 'high' },
      { index: 5, time: 5, price: 4, kind: 'low' },
    ]);
    expect(labeled.map((s) => s.label)).toEqual([null, null, 'HH', 'HL', 'LH', 'LL']);
  });
});

describe('analyzeStructure', () => {
  test('uptrend: HH/HL swings and a BOS when price closes above the last swing high', () => {
    // 100 → 110 → 105 → 115 → 108 → 120 : the leg to 115 closes above swing high 110 (BOS),
    // the leg to 120 closes above 115 (BOS again).
    const candles = path([100, 110, 105, 115, 108, 120], 4);
    const swings = detectSwings(candles, P);
    const s = analyzeStructure(candles, swings, P);
    expect(s.trend).toBe('bullish');
    expect(s.events.map((e) => `${e.kind}:${e.direction}`)).toEqual(['BOS:bullish', 'BOS:bullish']);
    expect(s.events[0]?.price).toBeCloseTo(110.1);
    expect(s.lastEvent?.kind).toBe('BOS');
    expect(s.swings.filter((x) => x.label).map((x) => x.label)).toEqual(['HH', 'HL']);
  });

  test('CHoCH: first close below the last higher low flips a bullish structure to bearish', () => {
    // Uptrend 100→110→105→115, then drop to 95 (closes below swing low 105 → CHoCH bearish),
    // bounce to 100, drop to 90 (closes below swing low 95 → BOS bearish).
    const candles = path([100, 110, 105, 115, 95, 100, 90], 4);
    const swings = detectSwings(candles, P);
    const s = analyzeStructure(candles, swings, P);
    const kinds = s.events.map((e) => `${e.kind}:${e.direction}`);
    expect(kinds).toEqual(['BOS:bullish', 'CHoCH:bearish', 'BOS:bearish']);
    expect(s.trend).toBe('bearish');
    const choch = s.events[1]!;
    expect(choch.price).toBeCloseTo(104.9); // swing low wick at pivot 105
    expect(choch.brokenSwing.kind).toBe('low');
  });

  test('a swing level fires only once', () => {
    // Two consecutive closes above the same swing high must not produce two BOS events.
    const candles = [...path([100, 110, 105, 112, 114], 4)];
    const swings = detectSwings(candles, P);
    const s = analyzeStructure(candles, swings, P);
    expect(s.events.filter((e) => e.price > 110 && e.price < 110.2)).toHaveLength(1);
  });

  test('ranging when swings alternate without breaks', () => {
    const candles = bars([
      [100, 101, 99, 100.5],
      [100.5, 102, 100, 101],
      [101, 103, 100.5, 102], // high 103
      [102, 102.5, 100.5, 101],
      [101, 101.5, 99, 100], // low 99
      [100, 102, 99.5, 101.5],
      [101.5, 102.9, 101, 102], // high 102.9 (LH)
      [102, 102.2, 100.5, 101],
      [101, 101.3, 99.5, 100.5], // low 99.5 (HL)
      [100.5, 101.5, 100, 101],
      [101, 101.6, 100.4, 101.2],
    ]);
    const swings = detectSwings(candles, P);
    const s = analyzeStructure(candles, swings, P);
    expect(s.events).toEqual([]);
    expect(s.trend).toBe('ranging');
  });
});
