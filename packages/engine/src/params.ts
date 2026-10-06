import type { Timeframe } from '@aurum/shared';

export type SwingParams = { left: number; right: number };

export type ZoneParams = {
  /** 1–4 small-bodied candles form a base. */
  maxBaseCandles: number;
  /** A base candle's body must be ≤ this × ATR. */
  baseBodyMaxAtr: number;
  /** Departure must travel ≥ this × ATR … */
  departureAtrMultiple: number;
  /** … within at most this many candles after the base. */
  departureMaxCandles: number;
  /** Candles before the base used to classify the arrival leg (rally vs drop). */
  arrivalLookback: number;
  /** Zone edges from base wicks or bodies. */
  edges: 'wick' | 'body';
  /** Keep only the newest N non-invalidated zones per timeframe. */
  maxZonesPerTf: number;
  /** Age scoring: full score up to this many candles … */
  ageFullScoreCandles: number;
  /** … linearly down to zero at this many candles. */
  ageZeroScoreCandles: number;
  /** A structure event within this many candles after the departure marks the zone as the leg origin. */
  structureLookaheadCandles: number;
};

export type PressureParams = {
  /** Candles (entry TF) inspected for a zone touch + patterns. */
  lookback: number;
  rejectionWickRatio: number;
  pinWickRatio: number;
  pinBodyMaxRatio: number;
};

export type RiskParams = {
  slBufferAtr: number;
  slBufferMin: number;
  rrTp1: 1.5;
  rrTp2: 2;
  /** XAUUSD: 1 standard lot = 100 oz → $100 per $1 move. */
  contractSize: number;
};

export type LifecycleParams = {
  /** Entry-TF candles a `watching` setup may wait for price. */
  expiryCandles: number;
  /** Extra entry-TF candles granted once a setup becomes `valid`. */
  validExpiryCandles: number;
};

export type ScoreWeights = { departure: number; freshness: number; structure: number; age: number };

export type EngineParams = {
  atrPeriod: number;
  swings: Record<Timeframe, SwingParams>;
  zones: ZoneParams;
  pressure: PressureParams;
  risk: RiskParams;
  lifecycle: LifecycleParams;
  scoreWeights: ScoreWeights;
  /** Zones below this score are never proposed as setups. */
  minZoneScore: number;
  /** Pressure score required to turn `watching` into `valid`. */
  minPressureScore: number;
};

export const DEFAULT_PARAMS: EngineParams = {
  atrPeriod: 14,
  swings: {
    M1: { left: 2, right: 2 },
    M5: { left: 2, right: 2 },
    M15: { left: 3, right: 3 },
    M30: { left: 3, right: 3 },
  },
  zones: {
    maxBaseCandles: 4,
    baseBodyMaxAtr: 0.6,
    departureAtrMultiple: 1.5,
    departureMaxCandles: 3,
    arrivalLookback: 3,
    edges: 'wick',
    maxZonesPerTf: 12,
    ageFullScoreCandles: 50,
    ageZeroScoreCandles: 500,
    structureLookaheadCandles: 12,
  },
  pressure: { lookback: 3, rejectionWickRatio: 0.5, pinWickRatio: 0.66, pinBodyMaxRatio: 0.25 },
  risk: { slBufferAtr: 0.1, slBufferMin: 0.3, rrTp1: 1.5, rrTp2: 2, contractSize: 100 },
  lifecycle: { expiryCandles: 48, validExpiryCandles: 16 },
  scoreWeights: { departure: 0.35, freshness: 0.25, structure: 0.25, age: 0.15 },
  minZoneScore: 40,
  minPressureScore: 30,
};

/** Deep-ish merge of overrides onto defaults (one level per section). Returns a new object. */
export function withParams(overrides: Partial<EngineParams> = {}): EngineParams {
  return {
    ...DEFAULT_PARAMS,
    ...overrides,
    swings: { ...DEFAULT_PARAMS.swings, ...(overrides.swings ?? {}) },
    zones: { ...DEFAULT_PARAMS.zones, ...(overrides.zones ?? {}) },
    pressure: { ...DEFAULT_PARAMS.pressure, ...(overrides.pressure ?? {}) },
    risk: { ...DEFAULT_PARAMS.risk, ...(overrides.risk ?? {}) },
    lifecycle: { ...DEFAULT_PARAMS.lifecycle, ...(overrides.lifecycle ?? {}) },
    scoreWeights: { ...DEFAULT_PARAMS.scoreWeights, ...(overrides.scoreWeights ?? {}) },
  };
}
