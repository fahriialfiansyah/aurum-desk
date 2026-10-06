import { describe, expect, test } from 'vitest';
import { CandleSchema, bodySize, lowerWick, m1CandleSchema, upperWick } from '../src/candle';

const valid = { time: 1_756_684_800, open: 3447.685, high: 3447.685, low: 3445.815, close: 3446.185, volume: 0.13 };

describe('CandleSchema', () => {
  test('accepts a valid candle and defaults volume to 0', () => {
    const parsed = CandleSchema.parse({ ...valid, volume: undefined });
    expect(parsed.volume).toBe(0);
  });

  test('rejects low above min(open, close)', () => {
    expect(CandleSchema.safeParse({ ...valid, low: 3447 }).success).toBe(false);
  });

  test('rejects high below max(open, close)', () => {
    expect(CandleSchema.safeParse({ ...valid, high: 3446 }).success).toBe(false);
  });

  test('rejects non-positive prices', () => {
    expect(CandleSchema.safeParse({ ...valid, open: 0 }).success).toBe(false);
  });
});

describe('m1CandleSchema', () => {
  test('rejects candles not aligned to a minute boundary', () => {
    expect(m1CandleSchema(valid.time + 120).safeParse({ ...valid, time: valid.time + 30 }).success).toBe(false);
  });

  test('rejects candles in the future', () => {
    expect(m1CandleSchema(valid.time - 60).safeParse(valid).success).toBe(false);
  });

  test('accepts aligned, past candles', () => {
    expect(m1CandleSchema(valid.time + 60).safeParse(valid).success).toBe(true);
  });
});

describe('candle anatomy helpers', () => {
  test('computes body and wicks', () => {
    const c = { time: 0, open: 10, high: 14, low: 8, close: 12, volume: 0 };
    expect(bodySize(c)).toBe(2);
    expect(upperWick(c)).toBe(2);
    expect(lowerWick(c)).toBe(2);
  });
});
