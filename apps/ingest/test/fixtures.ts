import type { Candle } from '@aurum/shared';

/** Tuesday 2025-09-02 10:00 UTC (market open, summer time). */
export const T0 = Date.UTC(2025, 8, 2, 10, 0) / 1000;

export function series(count: number, start = T0, price = 3500, step = 0.1): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const p = price + i * step;
    return { time: start + i * 60, open: p, high: p + 0.5, low: p - 0.5, close: p + 0.2, volume: 1 };
  });
}
