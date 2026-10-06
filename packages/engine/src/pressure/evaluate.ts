import type { Candle, Direction, Zone } from '@aurum/shared';
import { zoneProximalEdge } from '@aurum/shared';
import type { PressureParams } from '../params';
import { isConsecutiveExpansion, isEngulfing, isInsideBarBreak, isPinBar, isRejectionWick } from './patterns';

export const PRESSURE_PATTERNS = ['rejection_wick', 'engulfing', 'pin_bar', 'inside_bar_break', 'consecutive_expansion'] as const;
export type PressurePattern = (typeof PRESSURE_PATTERNS)[number];

export type PressureResult = { score: number; patterns: PressurePattern[]; touched: boolean };

const PATTERN_WEIGHT: Record<PressurePattern, number> = {
  rejection_wick: 35,
  engulfing: 35,
  pin_bar: 40,
  inside_bar_break: 30,
  consecutive_expansion: 30,
};
/** Bonus when the latest close is back outside the zone, on the trade side of the entry. */
const CLOSE_BEYOND_ENTRY_BONUS = 10;
const SCORE_MAX = 100;

export type ZoneLike = Pick<Zone, 'type' | 'top' | 'bottom'>;

function touchesZone(c: Candle, zone: ZoneLike): boolean {
  return c.low <= zone.top && c.high >= zone.bottom;
}

/**
 * Buying/selling pressure validation on the entry timeframe. Requires that price entered the zone
 * within the last `lookback` candles, then scores the price-action patterns on the latest candles.
 * Pure and deterministic; the LLM never changes this result.
 */
export function evaluatePressure(
  candles: readonly Candle[],
  zone: ZoneLike,
  direction: Direction,
  params: PressureParams,
): PressureResult {
  const n = candles.length;
  if (n === 0) return { score: 0, patterns: [], touched: false };
  const window = candles.slice(Math.max(0, n - params.lookback));
  const touched = window.some((c) => touchesZone(c, zone));
  if (!touched) return { score: 0, patterns: [], touched: false };

  const last = candles[n - 1]!;
  const prev = candles[n - 2];
  const prev2 = candles[n - 3];
  const patterns: PressurePattern[] = [];
  if (isRejectionWick(last, direction, params)) patterns.push('rejection_wick');
  if (prev && isEngulfing(prev, last, direction)) patterns.push('engulfing');
  if (isPinBar(last, direction, params)) patterns.push('pin_bar');
  if (prev && prev2 && isInsideBarBreak(prev2, prev, last, direction)) patterns.push('inside_bar_break');
  if (isConsecutiveExpansion(candles, direction)) patterns.push('consecutive_expansion');

  let score = patterns.reduce((acc, p) => acc + PATTERN_WEIGHT[p], 0);
  const entry = zoneProximalEdge(zone);
  const closedBeyondEntry = direction === 'long' ? last.close > entry : last.close < entry;
  if (patterns.length > 0 && closedBeyondEntry) score += CLOSE_BEYOND_ENTRY_BONUS;
  return { score: Math.min(SCORE_MAX, score), patterns, touched: true };
}
