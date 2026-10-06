import { describe, expect, test } from 'vitest';
import { SetupSchema, isJournalStatus, isTerminalStatus } from '../src/setup';
import { decodeWsServerMessage, encodeWsMessage } from '../src/ws';
import { isPriceInsideZone, zoneDistalEdge, zoneProximalEdge } from '../src/zone';

const now = new Date('2025-09-01T10:00:00.000Z').toISOString();

export const sampleSetup = {
  id: 'stp_1',
  playbook: 'scalp_m15_m5',
  direction: 'long',
  status: 'watching',
  bias: { tf: 'M15', trend: 'bullish', lastEvent: 'BOS', eventPrice: 3440.1 },
  zone: { id: 'zn_1', tf: 'M15', type: 'demand', top: 3435.5, bottom: 3433.2, score: 82, fresh: true, pattern: 'DBR' },
  entry: 3435.5,
  stopLoss: 3432.7,
  tp1: 3439.7,
  tp2: 3441.1,
  riskPts: 2.8,
  rr: { tp1: 1.5, tp2: 2 },
  pressure: null,
  rationale: { deterministic: ['Bias bullish (BOS @ 3440.10)'] },
  createdAt: now,
  updatedAt: now,
  expiresAt: now,
} as const;

describe('SetupSchema', () => {
  test('parses the canonical setup and defaults symbol', () => {
    const parsed = SetupSchema.parse(sampleSetup);
    expect(parsed.symbol).toBe('XAUUSD');
    expect(parsed.rr).toEqual({ tp1: 1.5, tp2: 2 });
  });
  test('rejects wrong RR constants', () => {
    expect(SetupSchema.safeParse({ ...sampleSetup, rr: { tp1: 1.5, tp2: 3 } }).success).toBe(false);
  });
  test('status helpers', () => {
    expect(isTerminalStatus('tp2')).toBe(true);
    expect(isTerminalStatus('tp1')).toBe(false);
    expect(isJournalStatus('stopped')).toBe(true);
    expect(isJournalStatus('expired')).toBe(false);
  });
});

describe('zone helpers', () => {
  const demand = { type: 'demand', top: 10, bottom: 8 } as const;
  const supply = { type: 'supply', top: 20, bottom: 18 } as const;
  test('proximal/distal edges depend on zone type', () => {
    expect(zoneProximalEdge(demand)).toBe(10);
    expect(zoneDistalEdge(demand)).toBe(8);
    expect(zoneProximalEdge(supply)).toBe(18);
    expect(zoneDistalEdge(supply)).toBe(20);
  });
  test('inside check is inclusive', () => {
    expect(isPriceInsideZone(10, demand)).toBe(true);
    expect(isPriceInsideZone(10.01, demand)).toBe(false);
  });
});

describe('WS protocol', () => {
  test('round-trips a setup message', () => {
    const raw = encodeWsMessage({ type: 'setup', setup: SetupSchema.parse(sampleSetup), transition: null });
    const decoded = decodeWsServerMessage(raw);
    expect(decoded.type).toBe('setup');
  });
  test('rejects unknown message types', () => {
    expect(() => decodeWsServerMessage(JSON.stringify({ type: 'nope' }))).toThrow();
  });
});
