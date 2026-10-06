import type { Candle } from '@aurum/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const T0 = Date.UTC(2025, 8, 2, 10, 0) / 1000;

export function m1Series(count: number, start = T0, price = 4500): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const p = price + Math.sin(i / 7) * 3 + i * 0.01;
    return { time: start + i * 60, open: p, high: p + 0.6, low: p - 0.6, close: p + 0.2, volume: 1 };
  });
}

let cached: Candle[] | null = null;
/** Real Dukascopy M1 bars shipped in data/ (ascending). */
export function realSample(): Candle[] {
  if (cached) return cached;
  const path = join(__dirname, '..', '..', '..', 'data', 'xauusd-m1-sample.csv');
  const lines = readFileSync(path, 'utf8').trim().split('\n').slice(1);
  cached = lines.map((line) => {
    const [t, o, h, l, c, v] = line.split(',');
    return { time: Date.parse(t!) / 1000, open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v) };
  });
  return cached;
}
