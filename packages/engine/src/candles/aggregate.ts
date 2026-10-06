import { bucketStart, TIMEFRAME_SECONDS, type Candle, type Timeframe } from '@aurum/shared';

/** Merge an M1 bar into a (possibly undefined) forming higher-timeframe bar. Returns a new object. */
export function mergeIntoBucket(bucket: Candle | undefined, m1: Candle, bucketTime: number): Candle {
  if (!bucket) {
    return { time: bucketTime, open: m1.open, high: m1.high, low: m1.low, close: m1.close, volume: m1.volume };
  }
  return {
    time: bucketTime,
    open: bucket.open,
    high: Math.max(bucket.high, m1.high),
    low: Math.min(bucket.low, m1.low),
    close: m1.close,
    volume: bucket.volume + m1.volume,
  };
}

/**
 * Aggregates ascending M1 candles into `tf` candles using epoch-aligned buckets
 * (the same alignment as Timescale's `time_bucket`). The last bucket is included even
 * when it is still forming; use `isBucketComplete` to know whether it closed.
 */
export function aggregateCandles(m1: readonly Candle[], tf: Timeframe): Candle[] {
  if (tf === 'M1') return [...m1];
  const out: Candle[] = [];
  let current: Candle | undefined;
  for (const bar of m1) {
    const start = bucketStart(bar.time, tf);
    if (current && current.time === start) {
      current = mergeIntoBucket(current, bar, start);
      out[out.length - 1] = current;
      continue;
    }
    current = mergeIntoBucket(undefined, bar, start);
    out.push(current);
  }
  return out;
}

/** True when the M1 bar at `lastM1Time` is the final minute of the `tf` bucket. */
export function isBucketComplete(lastM1Time: number, tf: Timeframe): boolean {
  const start = bucketStart(lastM1Time, tf);
  return lastM1Time === start + TIMEFRAME_SECONDS[tf] - TIMEFRAME_SECONDS.M1;
}
