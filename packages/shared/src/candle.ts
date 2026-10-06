import { z } from 'zod';
import { TIMEFRAME_SECONDS } from './timeframe';

const finitePrice = z.number().finite().positive();

/**
 * A single OHLCV bar. `time` is the bar OPEN time in unix seconds (UTC).
 * Used verbatim by the engine, the WebSocket protocol and the charts.
 */
export const CandleSchema = z
  .object({
    time: z.number().int().nonnegative(),
    open: finitePrice,
    high: finitePrice,
    low: finitePrice,
    close: finitePrice,
    volume: z.number().finite().nonnegative().default(0),
  })
  .refine((c) => c.low <= Math.min(c.open, c.close), { message: 'low must be <= min(open, close)', path: ['low'] })
  .refine((c) => c.high >= Math.max(c.open, c.close), { message: 'high must be >= max(open, close)', path: ['high'] });

export type Candle = z.infer<typeof CandleSchema>;

/** Stricter variant used at ingest boundaries: exact minute alignment and not in the future. */
export function m1CandleSchema(nowSec: number = Math.floor(Date.now() / 1000)) {
  return CandleSchema.refine((c) => c.time % TIMEFRAME_SECONDS.M1 === 0, {
    message: 'time must be on an exact minute boundary',
    path: ['time'],
  }).refine((c) => c.time <= nowSec, { message: 'candle is in the future', path: ['time'] });
}

export function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

export function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

export function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

export function range(c: Candle): number {
  return c.high - c.low;
}

export function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

export function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}
