import type { Candle } from '@aurum/shared';
import { describe, expect, test } from 'vitest';
import { aggregateCandles } from '../src/candles/aggregate';
import { refineZone, runPlaybook, selectCandidates } from '../src/playbooks/run';
import { T0, bars, choppy, concat, path, type Bar } from './fixtures';

/** Bullish M15 history: choppy warm-up, an uptrend with BOS, a drop-base-rally demand zone, then a pullback toward it. */
function bullishLower(): Candle[] {
  const warm = choppy(20, 100);
  const trend = path([100, 104, 102, 107, 105, 110], 4, 0.1); // BOS bullish events
  const drop: Bar[] = [
    [110, 110.2, 108.2, 108.4],
    [108.4, 108.6, 106.6, 106.8],
  ];
  const base: Bar[] = [
    [106.8, 107.2, 106.4, 106.9],
    [106.9, 107.1, 106.5, 106.7],
  ];
  const rally: Bar[] = [
    [106.7, 110.6, 106.6, 110.4],
    [110.4, 111.2, 110.2, 111],
    [111, 111.4, 110.6, 111.2],
  ];
  const drift: Bar[] = [
    [111.2, 111.5, 110.8, 111.1],
    [111.1, 111.3, 110.4, 110.6],
    [110.6, 110.9, 109.8, 110],
    [110, 110.2, 109.2, 109.4],
  ];
  return concat(warm, trend, bars(drop), bars(base), bars(rally), bars(drift));
}

function withStep(candles: Candle[], stepSec: number): Candle[] {
  return candles.map((c, i) => ({ ...c, time: T0 + i * stepSec }));
}

describe('runPlaybook', () => {
  test('B (M15 → M5): finds the bullish bias, picks the fresh demand zone and produces a watching setup with exact RR', () => {
    const m15 = withStep(bullishLower(), 900);
    // M5 = the same shape sampled finer: reuse the M15 bars as M5 bars for the entry timeframe.
    const m5 = withStep(bullishLower(), 300);
    const last = m5[m5.length - 1]!;
    const result = runPlaybook('scalp_m15_m5', { higher: m15, lower: m5, nowSec: last.time + 300 });
    expect(result.bias.trend).toBe('bullish');
    expect(result.bias.lastEvent).toBe('BOS');
    expect(result.direction).toBe('long');
    expect(result.candidates.length).toBeGreaterThan(0);
    const setup = result.best!;
    expect(setup).not.toBeNull();
    expect(setup.playbook).toBe('scalp_m15_m5');
    expect(setup.direction).toBe('long');
    expect(setup.status).toBe('watching');
    expect(setup.zone.type).toBe('demand');
    expect(setup.zone.pattern).toBe('DBR');
    expect(setup.entry).toBe(setup.zone.top);
    expect(setup.stopLoss).toBeLessThan(setup.zone.bottom);
    expect(setup.tp1 - setup.entry).toBeCloseTo(1.5 * setup.riskPts, 2);
    expect(setup.tp2 - setup.entry).toBeCloseTo(2 * setup.riskPts, 2);
    expect(setup.rationale.deterministic.join('\n')).toMatch(/Bias M15 bullish/);
    expect(setup.rationale.deterministic.join('\n')).toMatch(/Menunggu harga masuk zona/);
    expect(setup.id).toBe(`stp-scalp_m15_m5-${setup.zone.id}`);
    expect(setup.expiresAt > setup.createdAt).toBe(true);
  });

  test('A (M30 → M15) uses the M30 bias timeframe', () => {
    const m30 = withStep(bullishLower(), 1800);
    const m15 = withStep(bullishLower(), 900);
    const last = m15[m15.length - 1]!;
    const result = runPlaybook('intraday_m30_m15', { higher: m30, lower: m15, nowSec: last.time + 900 });
    expect(result.bias.tf).toBe('M30');
    expect(result.best?.playbook).toBe('intraday_m30_m15');
  });

  test('becomes valid when price enters the zone with confirming pressure', () => {
    const m15 = withStep(bullishLower(), 900);
    const base = bullishLower();
    const entryTouch: Bar[] = [
      [109.4, 109.6, 107.0, 107.3], // bearish into the zone (top 107.2)
      [107.2, 109.8, 106.5, 109.6], // bullish engulfing (closes above the previous open)
    ];
    const m5 = withStep(concat(base, bars(entryTouch)), 300);
    const last = m5[m5.length - 1]!;
    const result = runPlaybook('scalp_m15_m5', { higher: m15, lower: m5, nowSec: last.time + 300 });
    const setup = result.best!;
    expect(setup.status).toBe('valid');
    expect(setup.pressure?.patterns).toContain('engulfing');
    expect(setup.rationale.deterministic.join('\n')).toMatch(/Pressure \d+\/100/);
  });

  test('no setup when the bias is ranging, with a readable reason', () => {
    const ranging = withStep(choppy(60, 100), 900);
    const result = runPlaybook('scalp_m15_m5', { higher: ranging, lower: withStep(choppy(60, 100), 300), nowSec: T0 + 60 * 300 });
    expect(result.best).toBeNull();
    expect(result.reasons[0]).toMatch(/ranging/);
  });

  test('not enough data is reported, not thrown', () => {
    const result = runPlaybook('scalp_m15_m5', { higher: choppy(5, 100), lower: choppy(5, 100), nowSec: T0 });
    expect(result.best).toBeNull();
    expect(result.reasons[0]).toMatch(/belum cukup/);
  });
});

describe('selectCandidates & refineZone', () => {
  const zone = (over: Partial<ReturnType<typeof runPlaybook>['candidates'][number]>) => ({
    id: 'z',
    tf: 'M15' as const,
    type: 'demand' as const,
    pattern: 'DBR' as const,
    top: 100,
    bottom: 98,
    baseStart: 0,
    baseEnd: 0,
    departureEnd: 1,
    createdAt: 0,
    fresh: true,
    tested: false,
    invalidated: false,
    touches: 0,
    score: 70,
    scoreBreakdown: { departure: 50, freshness: 100, structure: 60, age: 100 },
    ...over,
  });

  test('filters by type, freshness, score and reachability; sorts by score then distance', () => {
    const zones = [
      zone({ id: 'far', top: 90, bottom: 88, score: 90 }),
      zone({ id: 'near', top: 100, bottom: 98, score: 90 }),
      zone({ id: 'tested', fresh: false, tested: true }),
      zone({ id: 'low', score: 20 }),
      zone({ id: 'supply', type: 'supply', top: 120, bottom: 118 }),
      zone({ id: 'passed', top: 110, bottom: 108 }), // price 105 is below this demand zone
    ];
    expect(selectCandidates(zones, 'long', 105, 40).map((z) => z.id)).toEqual(['near', 'far']);
    expect(selectCandidates(zones, 'short', 105, 40).map((z) => z.id)).toEqual(['supply']);
  });

  test('refineZone picks the best fresh lower-TF zone nested in the parent', () => {
    const parent = zone({ top: 100, bottom: 96 });
    const lower = [
      zone({ id: 'a', tf: 'M5', top: 99.5, bottom: 98.5, score: 60 }),
      zone({ id: 'b', tf: 'M5', top: 97.5, bottom: 96.5, score: 75 }),
      zone({ id: 'outside', tf: 'M5', top: 103, bottom: 101, score: 99 }),
      zone({ id: 'stale', tf: 'M5', top: 98, bottom: 97, score: 99, fresh: false }),
    ];
    expect(refineZone(parent, lower)?.id).toBe('b');
    expect(refineZone(parent, [])).toBeNull();
  });
});

describe('aggregate + playbook on the same data agree on boundaries', () => {
  test('M5 → M15 aggregation feeds the playbook without errors', () => {
    const m1 = withStep(bullishLower(), 60);
    const m5 = aggregateCandles(m1, 'M5');
    const m15 = aggregateCandles(m1, 'M15');
    expect(() => runPlaybook('scalp_m15_m5', { higher: m15, lower: m5, nowSec: m5[m5.length - 1]!.time + 300 })).not.toThrow();
  });
});
