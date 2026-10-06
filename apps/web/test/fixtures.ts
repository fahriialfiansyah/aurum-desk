import type { AnalysisSnapshot, Setup, Zone } from '@aurum/shared';

export const T0 = Date.UTC(2026, 8, 1, 10, 0) / 1000;

export const zone: Zone = {
  id: 'M15-demand-1',
  tf: 'M15',
  type: 'demand',
  pattern: 'DBR',
  top: 4592.1,
  bottom: 4588.4,
  baseStart: 10,
  baseEnd: 11,
  departureEnd: 12,
  createdAt: T0,
  fresh: true,
  tested: false,
  invalidated: false,
  touches: 0,
  score: 78,
  scoreBreakdown: { departure: 60, freshness: 100, structure: 60, age: 100 },
};

export const setup: Setup = {
  id: 'stp-scalp_m15_m5-M15-demand-1',
  symbol: 'XAUUSD',
  playbook: 'scalp_m15_m5',
  direction: 'long',
  status: 'valid',
  bias: { tf: 'M15', trend: 'bullish', lastEvent: 'BOS', eventPrice: 4601.2 },
  zone: { id: zone.id, tf: 'M15', type: 'demand', top: 4592.1, bottom: 4588.4, score: 78, fresh: true, pattern: 'DBR' },
  entry: 4592.1,
  stopLoss: 4587.9,
  tp1: 4598.4,
  tp2: 4600.5,
  riskPts: 4.2,
  rr: { tp1: 1.5, tp2: 2 },
  pressure: { score: 70, patterns: ['engulfing'] },
  rationale: { deterministic: ['Bias M15 bullish — BOS terakhir @ 4601.20'] },
  createdAt: new Date(T0 * 1000).toISOString(),
  updatedAt: new Date(T0 * 1000).toISOString(),
  expiresAt: new Date((T0 + 3600) * 1000).toISOString(),
};

export const analysis: AnalysisSnapshot = {
  tf: 'M15',
  structure: {
    trend: 'bullish',
    swings: [
      { index: 3, time: T0 - 3600, price: 4580, kind: 'low', label: 'HL' },
      { index: 7, time: T0 - 1800, price: 4601.2, kind: 'high', label: 'HH' },
      { index: 1, time: T0 - 7200, price: 4575, kind: 'low', label: null },
    ],
    events: [{ kind: 'BOS', direction: 'bullish', index: 9, time: T0 - 900, price: 4601.2, brokenSwing: { index: 7, time: T0 - 1800, price: 4601.2, kind: 'high' } }],
    lastEvent: null,
  },
  zones: [zone],
  atr: 5.1,
  computedAt: new Date(T0 * 1000).toISOString(),
};
