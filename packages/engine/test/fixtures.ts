import type { Candle } from '@aurum/shared';

export const T0 = Date.UTC(2025, 8, 1, 10, 0) / 1000; // Monday 2025-09-01 10:00 UTC
export const M5 = 300;
export const M15 = 900;
export const M30 = 1800;

export type Bar = [open: number, high: number, low: number, close: number, volume?: number];

/** Build consecutive candles from compact tuples starting at `start`. */
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

/**
 * Choppy warm-up: alternating 0.8 bodies with a 1.0 range → ATR(14) = 1.0 and no candle
 * small-bodied enough to be a zone base. Use it before zone/pressure scenarios.
 */
export function choppy(count: number, price: number, start: number = T0, stepSec = 60): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const up = i % 2 === 0;
    return {
      time: start + i * stepSec,
      open: up ? price - 0.4 : price + 0.4,
      high: price + 0.5,
      low: price - 0.5,
      close: up ? price + 0.4 : price - 0.4,
      volume: 1,
    };
  });
}

/**
 * Zig-zag price path: moves linearly between pivot prices, `perLeg` candles per leg.
 * Pivot candles become clean fractal highs/lows; wicks are `wick` beyond the body.
 */
export function path(pivots: readonly number[], perLeg = 4, wick = 0.1, start: number = T0, stepSec = 60): Candle[] {
  const out: Candle[] = [];
  let prevClose = pivots[0]!;
  let t = start;
  for (let p = 1; p < pivots.length; p += 1) {
    const from = pivots[p - 1]!;
    const to = pivots[p]!;
    for (let k = 1; k <= perLeg; k += 1) {
      const close = from + ((to - from) * k) / perLeg;
      const open = prevClose;
      const high = Math.max(open, close) + wick;
      const low = Math.min(open, close) - wick;
      out.push({ time: t, open, high, low, close, volume: 1 });
      prevClose = close;
      t += stepSec;
    }
  }
  return out;
}

export function concat(...series: Candle[][]): Candle[] {
  const out: Candle[] = [];
  let t = series[0]?.[0]?.time ?? T0;
  let step = 60;
  const first = series[0];
  if (first && first.length > 1) step = first[1]!.time - first[0]!.time;
  for (const s of series) {
    for (const c of s) {
      out.push({ ...c, time: t });
      t += step;
    }
  }
  return out;
}
