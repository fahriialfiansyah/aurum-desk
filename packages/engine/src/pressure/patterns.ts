import type { Candle, Direction } from '@aurum/shared';
import type { PressureParams } from '../params';

const range = (c: Candle) => c.high - c.low;
const body = (c: Candle) => Math.abs(c.close - c.open);
const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close);
const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low;
const bullish = (c: Candle) => c.close > c.open;
const bearish = (c: Candle) => c.close < c.open;

/** Wick on the zone side ≥ `rejectionWickRatio` of the range, closing away from the zone. */
export function isRejectionWick(c: Candle, direction: Direction, params: PressureParams): boolean {
  const r = range(c);
  if (r <= 0) return false;
  const wick = direction === 'long' ? lowerWick(c) : upperWick(c);
  const closesAway = direction === 'long' ? c.close > c.low + r / 2 : c.close < c.high - r / 2;
  return wick / r >= params.rejectionWickRatio && closesAway;
}

/** Body engulfs the previous candle's body, in the trade direction, after an opposite candle. */
export function isEngulfing(prev: Candle, c: Candle, direction: Direction): boolean {
  if (direction === 'long') {
    return bullish(c) && bearish(prev) && c.close >= prev.open && c.open <= prev.close && body(c) > body(prev);
  }
  return bearish(c) && bullish(prev) && c.close <= prev.open && c.open >= prev.close && body(c) > body(prev);
}

/** Long tail toward the zone (≥ pinWickRatio) with a tiny body (≤ pinBodyMaxRatio). */
export function isPinBar(c: Candle, direction: Direction, params: PressureParams): boolean {
  const r = range(c);
  if (r <= 0) return false;
  const tail = direction === 'long' ? lowerWick(c) : upperWick(c);
  return tail / r >= params.pinWickRatio && body(c) / r <= params.pinBodyMaxRatio;
}

/** mother → inside bar → close beyond the mother bar in the trade direction. */
export function isInsideBarBreak(mother: Candle, inside: Candle, c: Candle, direction: Direction): boolean {
  const isInside = inside.high <= mother.high && inside.low >= mother.low;
  if (!isInside) return false;
  return direction === 'long' ? c.close > mother.high : c.close < mother.low;
}

/** Two or more consecutive directional closes with expanding bodies. */
export function isConsecutiveExpansion(candles: readonly Candle[], direction: Direction): boolean {
  if (candles.length < 2) return false;
  const last = candles.slice(-2);
  for (let i = 0; i < last.length; i += 1) {
    const c = last[i]!;
    const directional = direction === 'long' ? bullish(c) : bearish(c);
    if (!directional) return false;
    if (i > 0 && body(c) <= body(last[i - 1]!)) return false;
  }
  return true;
}
