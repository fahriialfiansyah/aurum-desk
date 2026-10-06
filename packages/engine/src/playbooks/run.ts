import {
  PLAYBOOKS,
  type Bias,
  type Candle,
  type Direction,
  type MarketStructure,
  type PlaybookId,
  type Setup,
  type Timeframe,
  type Zone,
} from '@aurum/shared';
import { atr } from '../indicators/atr';
import { withParams, type EngineParams } from '../params';
import { evaluatePressure } from '../pressure/evaluate';
import { computeLevels } from '../risk/levels';
import { buildSetup } from '../setups/build';
import { analyzeStructure } from '../structure/structure';
import { detectSwings } from '../structure/swings';
import { detectZones } from '../zones/index';

export type PlaybookInput = {
  /** Bias timeframe candles (M30 for A, M15 for B), ascending, closed bars only. */
  higher: readonly Candle[];
  /** Entry timeframe candles (M15 for A, M5 for B), ascending, closed bars only. */
  lower: readonly Candle[];
  /** Evaluation time (unix seconds) — normally the close time of the last `lower` candle. */
  nowSec: number;
};

export type TimeframeAnalysis = { tf: Timeframe; structure: MarketStructure; zones: Zone[]; atr: number | null };

export type PlaybookResult = {
  playbook: PlaybookId;
  bias: Bias;
  direction: Direction | null;
  higher: TimeframeAnalysis;
  lower: TimeframeAnalysis;
  /** Aligned, fresh, reachable zones on the bias timeframe, best first. */
  candidates: Zone[];
  best: Setup | null;
  runnerUps: Zone[];
  /** Why there is no setup (Indonesian, deterministic). Empty when `best` exists. */
  reasons: string[];
};

const RUNNER_UP_COUNT = 3;

function lastFinite(values: readonly number[]): number | null {
  const v = values[values.length - 1];
  return v === undefined || Number.isNaN(v) ? null : v;
}

function minimumBars(params: EngineParams, tf: Timeframe): number {
  return params.atrPeriod + params.swings[tf].left + params.swings[tf].right + 2;
}

function analyze(candles: readonly Candle[], tf: Timeframe, params: EngineParams): TimeframeAnalysis {
  const atrValues = atr(candles, params.atrPeriod);
  const swings = detectSwings(candles, params.swings[tf]);
  const structure = analyzeStructure(candles, swings, params.swings[tf]);
  const zones = detectZones(candles, atrValues, structure, tf, params);
  return { tf, structure, zones, atr: lastFinite(atrValues) };
}

function directionFor(structure: MarketStructure): Direction | null {
  if (structure.trend === 'bullish') return 'long';
  if (structure.trend === 'bearish') return 'short';
  return null;
}

/** Fresh, aligned, scored high enough, and not already left behind by price. */
export function selectCandidates(zones: readonly Zone[], direction: Direction, price: number, minScore: number): Zone[] {
  const wanted = direction === 'long' ? 'demand' : 'supply';
  return zones
    .filter((z) => z.type === wanted && z.fresh && z.score >= minScore)
    .filter((z) => (direction === 'long' ? price >= z.bottom : price <= z.top))
    .sort((a, b) => b.score - a.score || distance(a, price) - distance(b, price));
}

function distance(z: Zone, price: number): number {
  if (price > z.top) return price - z.top;
  if (price < z.bottom) return z.bottom - price;
  return 0;
}

/** The best fresh entry-timeframe zone of the same type whose midpoint lies inside the bias zone. */
export function refineZone(parent: Zone, lowerZones: readonly Zone[]): Zone | null {
  const inside = lowerZones.filter((z) => {
    const mid = (z.top + z.bottom) / 2;
    return z.type === parent.type && z.fresh && mid <= parent.top && mid >= parent.bottom;
  });
  return inside.sort((a, b) => b.score - a.score)[0] ?? null;
}

/**
 * Playbook A (intraday): bias + zones on M30, entry/validation on M15.
 * Playbook B (scalp):    bias + zones on M15, entry/validation on M5.
 * Deterministic: every price level comes from here, never from a model.
 */
export function runPlaybook(id: PlaybookId, input: PlaybookInput, overrides: Partial<EngineParams> = {}): PlaybookResult {
  const params = withParams(overrides);
  const { biasTf, entryTf } = PLAYBOOKS[id];
  const higher = analyze(input.higher, biasTf, params);
  const lower = analyze(input.lower, entryTf, params);
  const lastEvent = higher.structure.lastEvent;
  const bias: Bias = {
    tf: biasTf,
    trend: higher.structure.trend,
    lastEvent: lastEvent?.kind ?? null,
    eventPrice: lastEvent?.price ?? 0,
  };
  const empty = (reasons: string[]): PlaybookResult => ({
    playbook: id,
    bias,
    direction: null,
    higher,
    lower,
    candidates: [],
    best: null,
    runnerUps: [],
    reasons,
  });

  if (input.higher.length < minimumBars(params, biasTf) || input.lower.length < minimumBars(params, entryTf)) {
    return empty([`Data ${biasTf}/${entryTf} belum cukup untuk analisa`]);
  }
  const direction = directionFor(higher.structure);
  if (!direction) return empty([`Struktur ${biasTf} ranging — belum ada BOS/CHoCH, tidak ada bias`]);
  const lastLower = input.lower[input.lower.length - 1]!;
  const price = lastLower.close;
  const candidates = selectCandidates(higher.zones, direction, price, params.minZoneScore);
  if (candidates.length === 0) {
    const wanted = direction === 'long' ? 'demand' : 'supply';
    return empty([`Tidak ada zona ${wanted} ${biasTf} yang fresh & searah bias (skor ≥ ${params.minZoneScore})`]);
  }
  if (lower.atr === null) return empty([`ATR ${entryTf} belum tersedia`]);

  const parent = candidates[0]!;
  const refined = refineZone(parent, lower.zones);
  const zone = refined ?? parent;
  const levels = computeLevels({ direction, zone, atr: lower.atr }, params.risk);
  const pressure = evaluatePressure(input.lower, zone, direction, params.pressure);
  const best = buildSetup({
    playbook: id,
    direction,
    bias,
    zone,
    parentZone: refined ? parent : null,
    levels,
    pressure,
    nowSec: input.nowSec,
    minPressureScore: params.minPressureScore,
    lifecycle: params.lifecycle,
  });
  return {
    playbook: id,
    bias,
    direction,
    higher,
    lower,
    candidates,
    best,
    runnerUps: candidates.slice(1, 1 + RUNNER_UP_COUNT),
    reasons: [],
  };
}
