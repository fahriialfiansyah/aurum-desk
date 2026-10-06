import { describe, expect, test } from 'vitest';
import { aggregateCandles, isBucketComplete, mergeIntoBucket } from '../src/candles/aggregate';
import { T0, bars } from './fixtures';

const hour = bars(
  Array.from({ length: 60 }, (_, i): [number, number, number, number, number] => [3000 + i, 3000 + i + 0.5, 3000 + i - 0.5, 3000 + i + 0.25, 1]),
);

describe('aggregateCandles', () => {
  test('M1 passthrough returns a copy', () => {
    const out = aggregateCandles(hour, 'M1');
    expect(out).toEqual(hour);
    expect(out).not.toBe(hour);
  });

  test('M5 buckets align to :00/:05 and carry OHLCV correctly', () => {
    const m5 = aggregateCandles(hour, 'M5');
    expect(m5).toHaveLength(12);
    expect(m5[0]).toEqual({ time: T0, open: 3000, high: 3004.5, low: 2999.5, close: 3004.25, volume: 5 });
    expect(m5[11]?.time).toBe(T0 + 55 * 60);
  });

  test('M15 and M30 match the Timescale continuous-aggregate boundaries', () => {
    const m15 = aggregateCandles(hour, 'M15');
    expect(m15.map((c) => c.time)).toEqual([T0, T0 + 900, T0 + 1800, T0 + 2700]);
    expect(m15[3]?.close).toBe(3059.25);
    const m30 = aggregateCandles(hour, 'M30');
    expect(m30.map((c) => c.time)).toEqual([T0, T0 + 1800]);
    expect(m30[1]).toMatchObject({ open: 3030, high: 3059.5, low: 3029.5, close: 3059.25, volume: 30 });
  });

  test('starting mid-bucket still aligns to the bucket start', () => {
    const fromTen17 = hour.slice(17, 25); // 10:17 .. 10:24
    const m15 = aggregateCandles(fromTen17, 'M15');
    expect(m15.map((c) => c.time)).toEqual([T0 + 900]); // 10:15 bucket
    expect(m15[0]?.open).toBe(3017);
  });

  test('handles gaps (missing minutes) without inventing bars', () => {
    const withGap = [...hour.slice(0, 3), ...hour.slice(20, 22)]; // 10:00-10:02 and 10:20-10:21
    const m5 = aggregateCandles(withGap, 'M5');
    expect(m5.map((c) => c.time)).toEqual([T0, T0 + 1200]);
  });

  test('does not mutate inputs', () => {
    const first = hour[0]!;
    const merged = mergeIntoBucket(first, hour[1]!, first.time);
    expect(merged).not.toBe(first);
    expect(first.close).toBe(3000.25);
  });
});

describe('isBucketComplete', () => {
  test('last minute of each bucket', () => {
    expect(isBucketComplete(T0 + 4 * 60, 'M5')).toBe(true);
    expect(isBucketComplete(T0 + 3 * 60, 'M5')).toBe(false);
    expect(isBucketComplete(T0 + 29 * 60, 'M30')).toBe(true);
    expect(isBucketComplete(T0 + 14 * 60, 'M15')).toBe(true);
    expect(isBucketComplete(T0, 'M1')).toBe(true);
  });
});
