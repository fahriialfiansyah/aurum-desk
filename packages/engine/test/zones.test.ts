import type { Candle, MarketStructure } from '@aurum/shared';
import { describe, expect, test } from 'vitest';
import { atr } from '../src/indicators/atr';
import { DEFAULT_PARAMS } from '../src/params';
import { detectZoneCandidates } from '../src/zones/detect';
import { ageScore, departureScore, freshnessScore, scoreZone, structureScore } from '../src/zones/score';
import { computeZoneState } from '../src/zones/state';
import { detectZones, pruneZones } from '../src/zones/index';
import { bars, choppy, concat, type Bar } from './fixtures';

const noStructure: MarketStructure = { trend: 'ranging', swings: [], events: [], lastEvent: null };
const P = DEFAULT_PARAMS;

/** 20 warm-up candles (ATR = 1.0), then the given tuples. */
function scenario(tuples: Bar[]): Candle[] {
  return concat(choppy(20, 100), bars(tuples));
}

const DROP: Bar[] = [
  [100, 100.2, 98.2, 98.4],
  [98.4, 98.6, 96.6, 96.8],
];
const RALLY: Bar[] = [
  [100, 101.8, 99.8, 101.6],
  [101.6, 103.4, 101.4, 103.2],
];
const BASE_LOW: Bar[] = [
  [96.8, 97.2, 96.4, 96.9],
  [96.9, 97.1, 96.5, 96.7],
];
const BASE_HIGH: Bar[] = [
  [103.2, 103.6, 102.8, 103.3],
  [103.3, 103.5, 102.9, 103.1],
];
const UP_FROM_LOW: Bar[] = [
  [96.7, 100.6, 96.6, 100.4],
  [100.4, 101.2, 100.2, 101],
  [101, 101.4, 100.6, 101.2],
];
const UP_FROM_HIGH: Bar[] = [
  [103.1, 107.2, 103, 107],
  [107, 107.6, 106.6, 107.4],
];
const DOWN_FROM_HIGH: Bar[] = [
  [103.1, 103.2, 99.2, 99.4],
  [99.4, 99.6, 98.6, 98.8],
];
const DOWN_FROM_LOW: Bar[] = [
  [96.7, 96.8, 92.6, 92.8],
  [92.8, 93, 92.2, 92.4],
];

describe('detectZoneCandidates — the four patterns', () => {
  test('Drop-Base-Rally → demand (DBR)', () => {
    const candles = scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]);
    const zones = detectZoneCandidates(candles, atr(candles), 'M15', P.zones);
    expect(zones).toHaveLength(1);
    const z = zones[0]!;
    expect(z.type).toBe('demand');
    expect(z.pattern).toBe('DBR');
    expect(z.baseStart).toBe(22);
    expect(z.baseEnd).toBe(23);
    expect(z.departureEnd).toBe(24);
    expect(z.top).toBeCloseTo(97.2);
    expect(z.bottom).toBeCloseTo(96.4);
    expect(z.id).toBe(`M15-demand-${candles[22]!.time}`);
  });

  test('Rally-Base-Rally → demand (RBR, continuation)', () => {
    const candles = scenario([...RALLY, ...BASE_HIGH, ...UP_FROM_HIGH]);
    const zones = detectZoneCandidates(candles, atr(candles), 'M15', P.zones);
    expect(zones.map((z) => z.pattern)).toEqual(['RBR']);
    expect(zones[0]?.type).toBe('demand');
  });

  test('Rally-Base-Drop → supply (RBD)', () => {
    const candles = scenario([...RALLY, ...BASE_HIGH, ...DOWN_FROM_HIGH]);
    const zones = detectZoneCandidates(candles, atr(candles), 'M15', P.zones);
    expect(zones.map((z) => z.pattern)).toEqual(['RBD']);
    expect(zones[0]?.type).toBe('supply');
    expect(zones[0]?.top).toBeCloseTo(103.6);
  });

  test('Drop-Base-Drop → supply (DBD, continuation)', () => {
    const candles = scenario([...DROP, ...BASE_LOW, ...DOWN_FROM_LOW]);
    const zones = detectZoneCandidates(candles, atr(candles), 'M15', P.zones);
    expect(zones.map((z) => z.pattern)).toEqual(['DBD']);
    expect(zones[0]?.type).toBe('supply');
  });

  test('no zone without an impulsive departure or with a trending (non-overlapping) base', () => {
    const weak = scenario([...DROP, ...BASE_LOW, [96.7, 97.4, 96.6, 97.3], [97.3, 97.9, 97.2, 97.8]]);
    expect(detectZoneCandidates(weak, atr(weak), 'M15', P.zones)).toHaveLength(0);
    const trendingBase = scenario([...DROP, [96.8, 97.2, 96.4, 96.9], [98.5, 98.9, 98.2, 98.7], [98.7, 102.6, 98.6, 102.4]]);
    const zones = detectZoneCandidates(trendingBase, atr(trendingBase), 'M15', P.zones);
    // Only the single candle right before the departure can be the base (the two do not overlap).
    expect(zones).toHaveLength(1);
    expect(zones[0]?.baseStart).toBe(zones[0]?.baseEnd);
  });

  test('body edges option shrinks the zone to the bodies', () => {
    const candles = scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]);
    const [z] = detectZoneCandidates(candles, atr(candles), 'M15', { ...P.zones, edges: 'body' });
    expect(z?.top).toBeCloseTo(96.9);
    expect(z?.bottom).toBeCloseTo(96.7);
  });
});

describe('computeZoneState', () => {
  const base = scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]);
  const zone = detectZoneCandidates(base, atr(base), 'M15', P.zones)[0]!;
  const after = (tuples: Bar[]) => concat(base, bars(tuples));

  test('fresh and untouched right after creation', () => {
    expect(computeZoneState(zone, base)).toEqual({ touches: 0, invalidated: false, tested: false, fresh: true });
  });

  test('first visit in progress is still fresh; after leaving it is tested', () => {
    const touching = after([[101.2, 101.3, 97.0, 97.5]]);
    expect(computeZoneState(zone, touching)).toMatchObject({ touches: 1, fresh: true, tested: false });
    const left = after([
      [101.2, 101.3, 97.0, 97.5],
      [97.5, 99.5, 97.4, 99.3],
    ]);
    expect(computeZoneState(zone, left)).toMatchObject({ touches: 1, fresh: false, tested: true });
  });

  test('a body close through the distal edge invalidates', () => {
    const broken = after([
      [101.2, 101.3, 97.0, 97.5],
      [97.5, 97.6, 95.8, 96.0],
    ]);
    expect(computeZoneState(zone, broken)).toMatchObject({ invalidated: true, fresh: false });
  });

  test('a wick through the zone without a close does not invalidate', () => {
    const wick = after([[101.2, 101.3, 96.0, 97.0]]);
    expect(computeZoneState(zone, wick)).toMatchObject({ invalidated: false, touches: 1 });
  });
});

describe('scoring', () => {
  test('departure strength saturates at 4×ATR', () => {
    expect(departureScore(1.5, 0)).toBe(17);
    expect(departureScore(4, 0)).toBe(100);
    expect(departureScore(6, 0)).toBe(100);
  });

  test('freshness ladder', () => {
    expect(freshnessScore({ touches: 0, fresh: true, tested: false, invalidated: false })).toBe(100);
    expect(freshnessScore({ touches: 1, fresh: false, tested: true, invalidated: false })).toBe(40);
    expect(freshnessScore({ touches: 3, fresh: false, tested: true, invalidated: false })).toBe(10);
    expect(freshnessScore({ touches: 3, fresh: false, tested: true, invalidated: true })).toBe(0);
  });

  test('age decays linearly after the grace window', () => {
    expect(ageScore(10, P.zones)).toBe(100);
    expect(ageScore(275, P.zones)).toBe(50);
    expect(ageScore(900, P.zones)).toBe(0);
  });

  test('zone at the origin of a BOS leg scores highest on structure', () => {
    const candles = scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]);
    const z = detectZoneCandidates(candles, atr(candles), 'M15', P.zones)[0]!;
    const withBos: MarketStructure = {
      ...noStructure,
      trend: 'bullish',
      events: [{ kind: 'BOS', direction: 'bullish', index: z.departureEnd + 1, time: 0, price: 100, brokenSwing: { index: 0, time: 0, price: 100, kind: 'high' } }],
    };
    expect(structureScore(z, withBos, P.zones)).toBe(100);
    expect(structureScore(z, { ...noStructure, trend: 'bullish' }, P.zones)).toBe(60);
    expect(structureScore(z, noStructure, P.zones)).toBe(40);
    expect(structureScore(z, { ...noStructure, trend: 'bearish' }, P.zones)).toBe(20);
  });

  test('scoreZone combines weighted components into 0–100 and strips internals', () => {
    const candles = scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]);
    const z = detectZoneCandidates(candles, atr(candles), 'M15', P.zones)[0]!;
    const scored = scoreZone({ ...z, ...computeZoneState(z, candles) }, { structure: noStructure, nowIndex: candles.length - 1 }, P.zones, P.scoreWeights);
    expect(scored.score).toBeGreaterThan(40);
    expect(scored.score).toBeLessThanOrEqual(100);
    expect(scored.scoreBreakdown.freshness).toBe(100);
    expect('departureAtr' in scored).toBe(false);
  });
});

describe('detectZones + pruneZones', () => {
  test('end-to-end returns scored, fresh zones and drops invalidated ones', () => {
    const candles = concat(scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]), bars([[101.2, 101.3, 97.0, 97.5], [97.5, 97.6, 95.8, 96.0]]));
    const zones = detectZones(candles, atr(candles), noStructure, 'M15', P);
    // The DBR demand zone was closed through → dropped; the sharp drop itself forms a new supply zone.
    expect(zones.some((z) => z.type === 'demand')).toBe(false);
    expect(zones.every((z) => !z.invalidated)).toBe(true);
    const alive = scenario([...DROP, ...BASE_LOW, ...UP_FROM_LOW]);
    expect(detectZones(alive, atr(alive), noStructure, 'M15', P)).toHaveLength(1);
  });

  test('newer overlapping zone supersedes the older one of the same type', () => {
    const mk = (createdAt: number, top: number, bottom: number): ReturnType<typeof detectZones>[number] => ({
      id: `M5-demand-${createdAt}`,
      tf: 'M5',
      type: 'demand',
      pattern: 'DBR',
      top,
      bottom,
      baseStart: 0,
      baseEnd: 0,
      departureEnd: 1,
      createdAt,
      fresh: true,
      tested: false,
      invalidated: false,
      touches: 0,
      score: 50,
      scoreBreakdown: { departure: 50, freshness: 100, structure: 40, age: 100 },
    });
    const pruned = pruneZones([mk(1, 100, 98), mk(2, 99.5, 97.5), mk(3, 120, 118)], 10);
    expect(pruned.map((z) => z.createdAt)).toEqual([2, 3]);
    expect(pruneZones([mk(1, 100, 98), mk(2, 110, 108), mk(3, 120, 118)], 2).map((z) => z.createdAt)).toEqual([2, 3]);
  });
});
