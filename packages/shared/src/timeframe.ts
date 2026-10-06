import { z } from 'zod';

export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30'] as const;
export const TimeframeSchema = z.enum(TIMEFRAMES);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { M1: 1, M5: 5, M15: 15, M30: 30 };
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = { M1: 60, M5: 300, M15: 900, M30: 1800 };

/** Higher timeframes are derived from M1; these are the ones the engine derives. */
export const DERIVED_TIMEFRAMES = ['M5', 'M15', 'M30'] as const satisfies readonly Timeframe[];

/** Start (unix seconds) of the bucket that contains `timeSec` for the given timeframe. Buckets are epoch-aligned. */
export function bucketStart(timeSec: number, tf: Timeframe): number {
  const size = TIMEFRAME_SECONDS[tf];
  return Math.floor(timeSec / size) * size;
}

/** True when an M1 bar opening at `m1OpenSec` is the last M1 bar of its `tf` bucket (so the `tf` bar closes with it). */
export function isLastM1OfBucket(m1OpenSec: number, tf: Timeframe): boolean {
  return bucketStart(m1OpenSec, tf) + TIMEFRAME_SECONDS[tf] - TIMEFRAME_SECONDS.M1 === m1OpenSec;
}
