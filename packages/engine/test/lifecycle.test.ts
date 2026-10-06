import type { Setup } from '@aurum/shared';
import { describe, expect, test } from 'vitest';
import { REALIZED_R, advanceSetup, advanceSetups, journalStats } from '../src/setups/lifecycle';
import { reconcileSetups } from '../src/setups/reconcile';
import { mergeSetup } from '../src/setups/build';
import { T0, bars } from './fixtures';

const created = new Date(T0 * 1000).toISOString();
const longSetup: Setup = {
  id: 'stp-scalp_m15_m5-M15-demand-1',
  symbol: 'XAUUSD',
  playbook: 'scalp_m15_m5',
  direction: 'long',
  status: 'valid',
  bias: { tf: 'M15', trend: 'bullish', lastEvent: 'BOS', eventPrice: 105 },
  zone: { id: 'M15-demand-1', tf: 'M15', type: 'demand', top: 100, bottom: 98, score: 80, fresh: true, pattern: 'DBR' },
  entry: 100,
  stopLoss: 97.5,
  tp1: 103.75,
  tp2: 105,
  riskPts: 2.5,
  rr: { tp1: 1.5, tp2: 2 },
  pressure: { score: 70, patterns: ['engulfing'] },
  rationale: { deterministic: ['x'] },
  createdAt: created,
  updatedAt: created,
  expiresAt: new Date((T0 + 3600) * 1000).toISOString(),
};
const shortSetup: Setup = {
  ...longSetup,
  id: 'stp-scalp_m15_m5-M15-supply-1',
  direction: 'short',
  zone: { ...longSetup.zone, id: 'M15-supply-1', type: 'supply', top: 102, bottom: 100 },
  entry: 100,
  stopLoss: 102.5,
  tp1: 96.25,
  tp2: 95,
};
const M5 = 300;
const c = (o: number, h: number, l: number, cl: number, i = 1) => bars([[o, h, l, cl]], T0 + i * M5)[0]!;

describe('advanceSetup (long)', () => {
  test('valid → triggered when the entry is touched, MFE tracked', () => {
    const r = advanceSetup(longSetup, c(101, 101.5, 99.8, 100.6));
    expect(r.transition).toBe('triggered');
    expect(r.setup.status).toBe('triggered');
    expect(r.setup.triggeredAt).toBeDefined();
    expect(r.setup.maxFavorableR).toBeCloseTo(0.6);
    expect(longSetup.status).toBe('valid'); // immutability
  });

  test('valid stays valid while price has not come back to the entry', () => {
    const r = advanceSetup(longSetup, c(101, 102, 100.5, 101.5));
    expect(r.transition).toBeNull();
    expect(r.setup.status).toBe('valid');
  });

  test('triggered → tp1 → tp2 with realized R of 1.75', () => {
    const t = advanceSetup(longSetup, c(101, 101.5, 99.8, 100.6)).setup;
    const a = advanceSetup(t, c(100.6, 104, 100.4, 103.9, 2));
    expect(a.transition).toBe('tp1');
    const b = advanceSetup(a.setup, c(103.9, 105.2, 103.5, 105.1, 3));
    expect(b.transition).toBe('tp2');
    expect(b.setup.realizedR).toBe(REALIZED_R.tp2);
    expect(b.setup.closedAt).toBeDefined();
    expect(advanceSetup(b.setup, c(1, 2, 0.5, 1, 4)).transition).toBeNull(); // terminal
  });

  test('triggered → stopped at −1R; stop wins over TP in the same candle (pessimistic)', () => {
    const t = advanceSetup(longSetup, c(101, 101.5, 99.8, 100.6)).setup;
    const r = advanceSetup(t, c(100.6, 104, 97.4, 103, 2));
    expect(r.transition).toBe('stopped');
    expect(r.setup.realizedR).toBe(REALIZED_R.stopped);
  });

  test('after tp1 the stop sits at breakeven and books +0.75R', () => {
    const t = advanceSetup(longSetup, c(101, 101.5, 99.8, 100.6)).setup;
    const a = advanceSetup(t, c(100.6, 104, 100.4, 103.9, 2)).setup;
    const r = advanceSetup(a, c(103.9, 104, 99.9, 101, 3));
    expect(r.transition).toBe('stopped');
    expect(r.setup.realizedR).toBe(REALIZED_R.tp1ThenBreakeven);
  });

  test('entry touch and stop in the same candle → triggered and stopped', () => {
    const r = advanceSetup(longSetup, c(101, 101.2, 97, 97.6));
    expect(r.transition).toBe('stopped');
    expect(r.setup.triggeredAt).toBeDefined();
  });

  test('watching → invalidated on a close through the zone, → expired after the deadline', () => {
    const watching: Setup = { ...longSetup, status: 'watching', pressure: null };
    expect(advanceSetup(watching, c(101, 101.5, 97, 97.5)).transition).toBe('invalidated');
    expect(advanceSetup(watching, c(101, 101.5, 100.5, 101, 20)).transition).toBe('expired');
    expect(advanceSetup(watching, c(101, 101.5, 100.5, 101, 2)).transition).toBeNull();
    expect(advanceSetup(watching, c(101, 101.5, 99, 100.5, 2)).transition).toBeNull(); // touch alone does not trigger an unvalidated setup
  });

  test('valid → expired when never triggered in time', () => {
    expect(advanceSetup(longSetup, c(101, 101.5, 100.5, 101, 20)).transition).toBe('expired');
  });
});

describe('advanceSetup (short) mirrors the long logic', () => {
  test('triggered then tp1 then tp2', () => {
    const t = advanceSetup(shortSetup, c(99, 100.2, 98.8, 99.2));
    expect(t.transition).toBe('triggered');
    const a = advanceSetup(t.setup, c(99.2, 99.5, 96.2, 96.4, 2));
    expect(a.transition).toBe('tp1');
    const b = advanceSetup(a.setup, c(96.4, 96.6, 94.8, 95, 3));
    expect(b.transition).toBe('tp2');
  });
  test('stopped above the supply zone', () => {
    const t = advanceSetup(shortSetup, c(99, 100.2, 98.8, 99.2)).setup;
    expect(advanceSetup(t, c(99.2, 102.6, 99, 102.4, 2)).transition).toBe('stopped');
  });
});

describe('advanceSetups, reconcileSetups, journalStats', () => {
  test('advanceSetups returns transitions only for changed setups', () => {
    const { setups, transitions } = advanceSetups([longSetup, { ...longSetup, id: 'other', status: 'watching' }], c(101, 101.5, 99.8, 100.6));
    expect(setups).toHaveLength(2);
    expect(transitions.map((t) => t.transition)).toEqual(['triggered']);
  });

  test('reconcile keeps progress and identity, refreshes analysis, adds new ones', () => {
    const later = new Date((T0 + 600) * 1000).toISOString();
    const proposedWatching: Setup = { ...longSetup, status: 'watching', pressure: null, createdAt: later, updatedAt: later, zone: { ...longSetup.zone, score: 90 } };
    const triggered: Setup = { ...longSetup, status: 'triggered', triggeredAt: later };
    const merged = reconcileSetups([triggered], [proposedWatching, { ...shortSetup, id: 'new' }]);
    expect(merged).toHaveLength(2);
    const kept = merged.find((s) => s.id === longSetup.id)!;
    expect(kept.status).toBe('triggered');
    expect(kept.createdAt).toBe(created);
    expect(kept.zone.score).toBe(80); // zone frozen once in a trade
    expect(mergeSetup({ ...longSetup, status: 'watching' }, { ...longSetup, status: 'valid' }).status).toBe('valid');
    expect(mergeSetup(longSetup, { ...longSetup, status: 'watching' }).status).toBe('valid');
  });

  test('reconcile drops terminal setups from the active list', () => {
    const done: Setup = { ...longSetup, status: 'tp2', closedAt: created, realizedR: 1.75 };
    expect(reconcileSetups([done], [])).toEqual([]);
  });

  test('journalStats counts closed trades only', () => {
    const closed = (realizedR: number): Setup => ({ ...longSetup, status: realizedR > 0 ? 'tp2' : 'stopped', closedAt: created, realizedR });
    const stats = journalStats([closed(1.75), closed(-1), closed(0.75), longSetup]);
    expect(stats.count).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.winRate).toBeCloseTo(2 / 3);
    expect(stats.avgR).toBe(0.5);
    expect(journalStats([])).toEqual({ count: 0, wins: 0, winRate: null, avgR: null, totalR: 0 });
  });
});
