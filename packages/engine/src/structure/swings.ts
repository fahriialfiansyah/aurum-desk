import type { Candle, SwingPoint } from '@aurum/shared';
import type { SwingParams } from '../params';

/**
 * Fractal swing points. A swing high at i has a high strictly above the `left` candles before it
 * and at least as high as the `right` candles after it (ties on the right keep the earlier candle).
 * Only confirmed swings are returned: the last `right` candles can never qualify.
 */
export function detectSwings(candles: readonly Candle[], params: SwingParams): SwingPoint[] {
  const { left, right } = params;
  if (left < 1 || right < 1) throw new RangeError('swing strength must be >= 1');
  const out: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const c = candles[i];
    if (!c) continue;
    if (isSwingHigh(candles, i, left, right)) out.push({ index: i, time: c.time, price: c.high, kind: 'high' });
    if (isSwingLow(candles, i, left, right)) out.push({ index: i, time: c.time, price: c.low, kind: 'low' });
  }
  return out;
}

function isSwingHigh(candles: readonly Candle[], i: number, left: number, right: number): boolean {
  const h = candles[i]!.high;
  for (let j = i - left; j < i; j += 1) if (candles[j]!.high >= h) return false;
  for (let j = i + 1; j <= i + right; j += 1) if (candles[j]!.high > h) return false;
  return true;
}

function isSwingLow(candles: readonly Candle[], i: number, left: number, right: number): boolean {
  const l = candles[i]!.low;
  for (let j = i - left; j < i; j += 1) if (candles[j]!.low <= l) return false;
  for (let j = i + 1; j <= i + right; j += 1) if (candles[j]!.low < l) return false;
  return true;
}

/** Index at which a swing becomes known (its confirming candle). */
export function swingConfirmedAt(swing: SwingPoint, right: number): number {
  return swing.index + right;
}
