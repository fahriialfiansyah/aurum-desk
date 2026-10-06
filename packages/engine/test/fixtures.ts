import type { Candle } from '@aurum/shared';

export const T0 = Date.UTC(2025, 8, 1, 10, 0) / 1000; // Monday 2025-09-01 10:00 UTC

export type Bar = [open: number, high: number, low: number, close: number, volume?: number];

/** Build consecutive candles (default M1) from compact tuples starting at `start`. */
export function bars(tuples: readonly Bar[], start: number = T0, stepSec = 60): Candle[] {
  return tuples.map(([open, high, low, close, volume = 1], i) => ({
    time: start + i * stepSec,
    open,
    high,
    low,
    close,
    volume,
  }));
}

/** Flat candles of constant range for warm-up sections. */
export function flat(count: number, price: number, halfRange = 0.5, start: number = T0, stepSec = 60): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * stepSec,
    open: price,
    high: price + halfRange,
    low: price - halfRange,
    close: price,
    volume: 1,
  }));
}
