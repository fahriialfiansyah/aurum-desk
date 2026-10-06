import type { Candle, MarketStructure, Timeframe, Zone } from '@aurum/shared';
import type { EngineParams } from '../params';
import { detectZoneCandidates } from './detect';
import { scoreZone } from './score';
import { updateZoneStates } from './state';

const OVERLAP_DROP_RATIO = 0.5;

function overlapRatio(a: { top: number; bottom: number }, b: { top: number; bottom: number }): number {
  const inter = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
  if (inter <= 0) return 0;
  const height = Math.min(a.top - a.bottom, b.top - b.bottom);
  return height <= 0 ? 1 : inter / height;
}

/** Newer zones supersede older overlapping zones of the same type; invalidated zones are dropped. */
export function pruneZones(zones: readonly Zone[], maxPerTf: number): Zone[] {
  const live = zones.filter((z) => !z.invalidated);
  const kept: Zone[] = [];
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const z = live[i]!;
    const superseded = kept.some((k) => k.type === z.type && overlapRatio(k, z) >= OVERLAP_DROP_RATIO);
    if (!superseded) kept.push(z);
  }
  return kept.reverse().slice(-maxPerTf);
}

/** Detect → state → score → prune, for one timeframe. Pure. */
export function detectZones(
  candles: readonly Candle[],
  atrValues: readonly number[],
  structure: MarketStructure,
  tf: Timeframe,
  params: EngineParams,
): Zone[] {
  const candidates = detectZoneCandidates(candles, atrValues, tf, params.zones);
  const withState = updateZoneStates(candidates, candles);
  const nowIndex = candles.length - 1;
  const scored = withState.map((z) => scoreZone(z, { structure, nowIndex }, params.zones, params.scoreWeights));
  return pruneZones(scored, params.zones.maxZonesPerTf);
}

export { detectZoneCandidates, zoneId } from './detect';
export type { ZoneCandidate } from './detect';
export { ageScore, departureScore, freshnessScore, scoreZone, structureScore } from './score';
export { computeZoneState, updateZoneStates } from './state';
export type { ZoneState } from './state';
