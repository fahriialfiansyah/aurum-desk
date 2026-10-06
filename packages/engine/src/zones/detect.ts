import { roundPrice, type Candle, type Timeframe, type Zone, type ZonePattern, type ZoneType } from '@aurum/shared';
import type { ZoneParams } from '../params';

export type ZoneCandidate = Omit<Zone, 'score' | 'scoreBreakdown' | 'fresh' | 'tested' | 'invalidated' | 'touches'> & {
  /** Departure travel in ATR multiples at the time of creation. */
  departureAtr: number;
};

const body = (c: Candle) => Math.abs(c.close - c.open);
const bodyTop = (c: Candle) => Math.max(c.open, c.close);
const bodyBottom = (c: Candle) => Math.min(c.open, c.close);

function baseEdges(candles: readonly Candle[], start: number, end: number, edges: ZoneParams['edges']) {
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = start; i <= end; i += 1) {
    const c = candles[i]!;
    top = Math.max(top, edges === 'wick' ? c.high : bodyTop(c));
    bottom = Math.min(bottom, edges === 'wick' ? c.low : bodyBottom(c));
  }
  // Zone edges live on the 0.01 grid so the entry line equals the zone edge exactly.
  return { top: roundPrice(top), bottom: roundPrice(bottom) };
}

/** Base candles must be small-bodied and overlap each other in price (a consolidation, not a trend). */
function isValidBase(candles: readonly Candle[], start: number, end: number, atr: number, params: ZoneParams): boolean {
  for (let i = start; i <= end; i += 1) {
    const c = candles[i]!;
    if (body(c) > params.baseBodyMaxAtr * atr) return false;
    if (i > start) {
      const prev = candles[i - 1]!;
      const overlaps = c.low <= prev.high && c.high >= prev.low;
      if (!overlaps) return false;
    }
  }
  return true;
}

type Departure = { end: number; direction: 'up' | 'down'; travel: number };

/** Smallest run of directional candles after the base whose close travels ≥ N×ATR from the base edge. */
function findDeparture(
  candles: readonly Candle[],
  baseEnd: number,
  top: number,
  bottom: number,
  atr: number,
  params: ZoneParams,
): Departure | null {
  const first = candles[baseEnd + 1];
  if (!first || first.close === first.open) return null;
  const direction: 'up' | 'down' = first.close > first.open ? 'up' : 'down';
  let prevClose = first.open;
  for (let k = 1; k <= params.departureMaxCandles; k += 1) {
    const c = candles[baseEnd + k];
    if (!c) return null;
    const directional = direction === 'up' ? c.close > c.open && c.close > prevClose : c.close < c.open && c.close < prevClose;
    if (!directional) return null;
    prevClose = c.close;
    const travel = direction === 'up' ? c.close - top : bottom - c.close;
    if (travel >= params.departureAtrMultiple * atr) return { end: baseEnd + k, direction, travel };
  }
  return null;
}

function arrivalDirection(candles: readonly Candle[], baseStart: number, lookback: number, fallback: 'up' | 'down'): 'up' | 'down' {
  const end = baseStart - 1;
  if (end < 0) return fallback;
  const start = Math.max(0, end - lookback + 1);
  const net = candles[end]!.close - candles[start]!.open;
  if (net === 0) return fallback;
  return net > 0 ? 'up' : 'down';
}

function patternFor(arrival: 'up' | 'down', departure: 'up' | 'down'): ZonePattern {
  if (departure === 'up') return arrival === 'up' ? 'RBR' : 'DBR';
  return arrival === 'up' ? 'RBD' : 'DBD';
}

export function zoneId(tf: Timeframe, type: ZoneType, createdAt: number): string {
  return `${tf}-${type}-${createdAt}`;
}

/**
 * Finds base + impulsive-departure structures. For each base end index the longest valid base
 * (≤ maxBaseCandles) is taken, then the shortest departure that satisfies the ATR travel rule.
 */
export function detectZoneCandidates(
  candles: readonly Candle[],
  atrValues: readonly number[],
  tf: Timeframe,
  params: ZoneParams,
): ZoneCandidate[] {
  const out: ZoneCandidate[] = [];
  let i = 0;
  while (i < candles.length - 1) {
    const atr = atrValues[i];
    if (atr === undefined || Number.isNaN(atr) || atr <= 0) {
      i += 1;
      continue;
    }
    let found: ZoneCandidate | null = null;
    for (let len = Math.min(params.maxBaseCandles, i + 1); len >= 1; len -= 1) {
      const start = i - len + 1;
      if (!isValidBase(candles, start, i, atr, params)) continue;
      const { top, bottom } = baseEdges(candles, start, i, params.edges);
      const dep = findDeparture(candles, i, top, bottom, atr, params);
      if (!dep) continue;
      const arrival = arrivalDirection(candles, start, params.arrivalLookback, dep.direction);
      const type: ZoneType = dep.direction === 'up' ? 'demand' : 'supply';
      const createdAt = candles[start]!.time;
      found = {
        id: zoneId(tf, type, createdAt),
        tf,
        type,
        pattern: patternFor(arrival, dep.direction),
        top,
        bottom,
        baseStart: start,
        baseEnd: i,
        departureEnd: dep.end,
        createdAt,
        departureAtr: dep.travel / atr,
      };
      break;
    }
    if (found) {
      out.push(found);
      i = found.departureEnd + 1;
      continue;
    }
    i += 1;
  }
  return out;
}
