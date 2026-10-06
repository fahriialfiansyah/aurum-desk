import { z } from 'zod';

export const LIVE_PROVIDER_NAMES = ['replay', 'twelvedata', 'mock'] as const;
export const LiveProviderNameSchema = z.enum(LIVE_PROVIDER_NAMES);
export type LiveProviderName = z.infer<typeof LiveProviderNameSchema>;

export const HISTORY_SOURCE_NAMES = ['dukascopy', 'twelvedata', 'mt5csv', 'tradingview'] as const;
export const HistorySourceNameSchema = z.enum(HISTORY_SOURCE_NAMES);
export type HistorySourceName = z.infer<typeof HistorySourceNameSchema>;

export const ReplayStateSchema = z.object({
  playing: z.boolean(),
  speed: z.number().positive(),
  /** Unix seconds of the candle currently being replayed. */
  cursorTime: z.number().int().nullable(),
  startTime: z.number().int().nullable(),
  endTime: z.number().int().nullable(),
  totalCandles: z.number().int().nonnegative(),
  position: z.number().int().nonnegative(),
});
export type ReplayState = z.infer<typeof ReplayStateSchema>;

export const FeedStatusSchema = z.object({
  provider: LiveProviderNameSchema,
  /** Loud flag for the UI: synthetic data is in use. */
  isMock: z.boolean(),
  /** The `source` column the engine reads historical candles from. */
  source: z.string(),
  connected: z.boolean(),
  lastCandleTime: z.number().int().nullable(),
  /** Seconds between now and the newest candle (null until the first candle). */
  lagSec: z.number().nullable(),
  message: z.string().optional(),
  replay: ReplayStateSchema.optional(),
});
export type FeedStatus = z.infer<typeof FeedStatusSchema>;
