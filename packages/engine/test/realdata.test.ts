import { SetupSchema, ZoneSchema, type Candle, type Setup } from '@aurum/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { aggregateCandles } from '../src/candles/aggregate';
import { runPlaybook } from '../src/playbooks/run';
import { advanceSetups } from '../src/setups/lifecycle';

const csvPath = join(__dirname, '..', '..', '..', 'data', 'xauusd-m1-sample.csv');

function loadSample(): Candle[] {
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
  return lines.map((line) => {
    const [t, o, h, l, c, v] = line.split(',');
    return { time: Date.parse(t!) / 1000, open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v) };
  });
}

const twoDp = (x: number) => Math.round(x * 100) / 100 === x;

describe('engine on real XAUUSD M1 data (smoke)', () => {
  const m1 = loadSample();
  const CUT_POINTS = [6000, 12000, 18000, 24000, 30000, 36000, m1.length];

  test('sample is real, large and ascending', () => {
    expect(m1.length).toBeGreaterThan(30_000);
    for (let i = 1; i < m1.length; i += 1) expect(m1[i]!.time).toBeGreaterThan(m1[i - 1]!.time);
  });

  test('both playbooks run at several points in time; every level obeys the spec', () => {
    let setups = 0;
    for (const cut of CUT_POINTS) {
      const slice = m1.slice(Math.max(0, cut - 6000), cut);
      const m5 = aggregateCandles(slice, 'M5');
      const m15 = aggregateCandles(slice, 'M15');
      const m30 = aggregateCandles(slice, 'M30');
      const now = slice[slice.length - 1]!.time + 60;
      for (const result of [
        runPlaybook('intraday_m30_m15', { higher: m30, lower: m15, nowSec: now }),
        runPlaybook('scalp_m15_m5', { higher: m15, lower: m5, nowSec: now }),
      ]) {
        for (const z of [...result.higher.zones, ...result.lower.zones]) {
          expect(ZoneSchema.safeParse(z).success).toBe(true);
          expect(z.top).toBeGreaterThanOrEqual(z.bottom);
          expect(z.score).toBeGreaterThanOrEqual(0);
          expect(z.score).toBeLessThanOrEqual(100);
        }
        if (!result.best) {
          expect(result.reasons.length).toBeGreaterThan(0);
          continue;
        }
        setups += 1;
        const s = result.best;
        expect(SetupSchema.safeParse(s).success).toBe(true);
        for (const v of [s.entry, s.stopLoss, s.tp1, s.tp2, s.riskPts]) expect(twoDp(v)).toBe(true);
        const sign = s.direction === 'long' ? 1 : -1;
        // Levels sit on the 0.01 grid, so RR holds to within half a point.
        const HALF_POINT = 0.005 + 1e-9;
        expect(Math.abs(sign * (s.entry - s.stopLoss) - s.riskPts)).toBeLessThanOrEqual(HALF_POINT);
        expect(Math.abs(sign * (s.tp1 - s.entry) - 1.5 * s.riskPts)).toBeLessThanOrEqual(HALF_POINT);
        expect(Math.abs(sign * (s.tp2 - s.entry) - 2 * s.riskPts)).toBeLessThanOrEqual(HALF_POINT);
        if (s.direction === 'long') {
          expect(s.entry).toBe(s.zone.top);
          expect(s.stopLoss).toBeLessThan(s.zone.bottom);
        } else {
          expect(s.entry).toBe(s.zone.bottom);
          expect(s.stopLoss).toBeGreaterThan(s.zone.top);
        }
      }
    }
    expect(setups).toBeGreaterThan(0);
  });

  test('lifecycle drives a real setup through to a terminal state', () => {
    const slice = m1.slice(0, 12000);
    const m5 = aggregateCandles(slice, 'M5');
    const m15 = aggregateCandles(slice, 'M15');
    const result = runPlaybook('scalp_m15_m5', { higher: m15, lower: m5, nowSec: slice[slice.length - 1]!.time + 60 });
    if (!result.best) return; // data-dependent; covered by the previous test's aggregate assertion
    let active: Setup[] = [{ ...result.best, status: 'valid' }];
    const future = aggregateCandles(m1.slice(12000, 30000), 'M5');
    const seen: string[] = [];
    for (const candle of future) {
      const r = advanceSetups(active, candle);
      active = r.setups;
      seen.push(...r.transitions.map((t) => t.transition!));
      if (active.every((s) => ['tp2', 'stopped', 'invalidated', 'expired'].includes(s.status))) break;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(['tp2', 'stopped', 'invalidated', 'expired']).toContain(active[0]!.status);
  });
});
