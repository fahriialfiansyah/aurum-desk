import type { Candle, LabeledSwing, MarketStructure, StructureEvent, SwingPoint, TrendState } from '@aurum/shared';
import type { SwingParams } from '../params';
import { swingConfirmedAt } from './swings';

/** HH/HL/LH/LL relative to the previous swing of the same kind. */
export function labelSwings(swings: readonly SwingPoint[]): LabeledSwing[] {
  let lastHigh: SwingPoint | undefined;
  let lastLow: SwingPoint | undefined;
  return swings.map((s) => {
    if (s.kind === 'high') {
      const label = lastHigh ? (s.price > lastHigh.price ? 'HH' : 'LH') : null;
      lastHigh = s;
      return { ...s, label };
    }
    const label = lastLow ? (s.price > lastLow.price ? 'HL' : 'LL') : null;
    lastLow = s;
    return { ...s, label };
  });
}

function trendFromLabels(swings: readonly LabeledSwing[]): TrendState {
  const lastHigh = [...swings].reverse().find((s) => s.kind === 'high')?.label;
  const lastLow = [...swings].reverse().find((s) => s.kind === 'low')?.label;
  if (lastHigh === 'HH' && lastLow === 'HL') return 'bullish';
  if (lastHigh === 'LH' && lastLow === 'LL') return 'bearish';
  return 'ranging';
}

/**
 * Walks candles chronologically. A swing becomes a reference only once confirmed. A body close
 * beyond the latest confirmed swing high/low is a break: in the direction of the current trend it
 * is a BOS, against it a CHoCH; with no established trend the first break is a BOS that sets it.
 * A broken swing is consumed so the same level cannot fire twice.
 */
export function analyzeStructure(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  params: SwingParams,
): MarketStructure {
  const labeled = labelSwings(swings);
  const events: StructureEvent[] = [];
  let trend: TrendState = 'ranging';
  let refHigh: SwingPoint | null = null;
  let refLow: SwingPoint | null = null;
  let cursor = 0;

  for (let i = 0; i < candles.length; i += 1) {
    while (cursor < swings.length && swingConfirmedAt(swings[cursor]!, params.right) <= i) {
      const s = swings[cursor]!;
      if (s.kind === 'high') refHigh = s;
      else refLow = s;
      cursor += 1;
    }
    const c = candles[i]!;
    if (refHigh && c.close > refHigh.price) {
      const kind = trend === 'bearish' ? 'CHoCH' : 'BOS';
      events.push({ kind, direction: 'bullish', index: i, time: c.time, price: refHigh.price, brokenSwing: refHigh });
      trend = 'bullish';
      refHigh = null;
    } else if (refLow && c.close < refLow.price) {
      const kind = trend === 'bullish' ? 'CHoCH' : 'BOS';
      events.push({ kind, direction: 'bearish', index: i, time: c.time, price: refLow.price, brokenSwing: refLow });
      trend = 'bearish';
      refLow = null;
    }
  }

  const lastEvent = events[events.length - 1] ?? null;
  const finalTrend: TrendState = lastEvent ? lastEvent.direction : trendFromLabels(labeled);
  return { trend: finalTrend, swings: labeled, events, lastEvent };
}
