import type { MarketStructure, Zone, ZoneScoreBreakdown } from '@aurum/shared';
import type { ScoreWeights, ZoneParams } from '../params';
import type { ZoneCandidate } from './detect';
import type { ZoneState } from './state';

export const SCORE_MAX = 100;
const DEPARTURE_FULL_SCORE_ATR = 4;
const FRESHNESS_SCORE = { fresh: 100, testedOnce: 40, testedMore: 10, invalidated: 0 } as const;
const STRUCTURE_SCORE = { legOrigin: 100, aligned: 60, ranging: 40, opposite: 20 } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function departureScore(departureAtr: number, minMultiple: number): number {
  return Math.round(clamp01((departureAtr - 1) / (DEPARTURE_FULL_SCORE_ATR - 1)) * SCORE_MAX * (departureAtr >= minMultiple ? 1 : 0));
}

export function freshnessScore(state: ZoneState): number {
  if (state.invalidated) return FRESHNESS_SCORE.invalidated;
  if (state.fresh) return FRESHNESS_SCORE.fresh;
  return state.touches <= 1 ? FRESHNESS_SCORE.testedOnce : FRESHNESS_SCORE.testedMore;
}

export function structureScore(zone: ZoneCandidate, structure: MarketStructure, params: ZoneParams): number {
  const wanted = zone.type === 'demand' ? 'bullish' : 'bearish';
  const legOrigin = structure.events.some(
    (e) =>
      e.direction === wanted &&
      e.index >= zone.departureEnd - params.departureMaxCandles &&
      e.index <= zone.departureEnd + params.structureLookaheadCandles,
  );
  if (legOrigin) return STRUCTURE_SCORE.legOrigin;
  if (structure.trend === 'ranging') return STRUCTURE_SCORE.ranging;
  return structure.trend === wanted ? STRUCTURE_SCORE.aligned : STRUCTURE_SCORE.opposite;
}

export function ageScore(candlesSince: number, params: ZoneParams): number {
  if (candlesSince <= params.ageFullScoreCandles) return SCORE_MAX;
  const span = params.ageZeroScoreCandles - params.ageFullScoreCandles;
  return Math.round(SCORE_MAX * clamp01((params.ageZeroScoreCandles - candlesSince) / span));
}

export function scoreZone(
  zone: ZoneCandidate & ZoneState,
  ctx: { structure: MarketStructure; nowIndex: number },
  params: ZoneParams,
  weights: ScoreWeights,
): Zone {
  const breakdown: ZoneScoreBreakdown = {
    departure: departureScore(zone.departureAtr, 0),
    freshness: freshnessScore(zone),
    structure: structureScore(zone, ctx.structure, params),
    age: ageScore(ctx.nowIndex - zone.baseEnd, params),
  };
  const score = Math.round(
    breakdown.departure * weights.departure +
      breakdown.freshness * weights.freshness +
      breakdown.structure * weights.structure +
      breakdown.age * weights.age,
  );
  const { departureAtr: _departureAtr, ...rest } = zone;
  return { ...rest, score: Math.min(SCORE_MAX, Math.max(0, score)), scoreBreakdown: breakdown };
}
