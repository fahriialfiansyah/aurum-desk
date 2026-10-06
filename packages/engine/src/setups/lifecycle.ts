import {
  PLAYBOOKS,
  TIMEFRAME_SECONDS,
  isTerminalStatus,
  isoFromSec,
  secFromIso,
  type Candle,
  type Setup,
  type SetupStatus,
} from '@aurum/shared';
import { rMultiple } from '../risk/levels';

/** Realized R with 50% closed at TP1 and the rest at TP2 or breakeven. */
export const REALIZED_R = { stopped: -1, tp1ThenBreakeven: 0.75, tp2: 1.75 } as const;

export type SetupTransition = { setup: Setup; transition: SetupStatus | null };

type Touch = { entry: boolean; stop: boolean; tp1: boolean; tp2: boolean; breakeven: boolean; closedThroughZone: boolean };

function touches(setup: Setup, c: Candle): Touch {
  if (setup.direction === 'long') {
    return {
      entry: c.low <= setup.entry,
      stop: c.low <= setup.stopLoss,
      tp1: c.high >= setup.tp1,
      tp2: c.high >= setup.tp2,
      breakeven: c.low <= setup.entry,
      closedThroughZone: c.close < setup.zone.bottom,
    };
  }
  return {
    entry: c.high >= setup.entry,
    stop: c.high >= setup.stopLoss,
    tp1: c.low <= setup.tp1,
    tp2: c.low <= setup.tp2,
    breakeven: c.high >= setup.entry,
    closedThroughZone: c.close > setup.zone.top,
  };
}

function bestPrice(setup: Setup, c: Candle): number {
  return setup.direction === 'long' ? c.high : c.low;
}

function close(setup: Setup, status: SetupStatus, realizedR: number | null, at: string): Setup {
  return { ...setup, status, updatedAt: at, closedAt: at, ...(realizedR === null ? {} : { realizedR }) };
}

/** Pessimistic resolution of a candle for an open position: stop first, then TP2, then TP1. */
function resolveOpen(setup: Setup, t: Touch, at: string): SetupTransition {
  if (t.stop) return { setup: close(setup, 'stopped', REALIZED_R.stopped, at), transition: 'stopped' };
  if (t.tp2) return { setup: close(setup, 'tp2', REALIZED_R.tp2, at), transition: 'tp2' };
  if (t.tp1 && setup.status !== 'tp1') return { setup: { ...setup, status: 'tp1', updatedAt: at }, transition: 'tp1' };
  return { setup: { ...setup, updatedAt: at }, transition: null };
}

/**
 * Pure state machine driven by each closed entry-timeframe candle.
 * watching → invalidated | expired; valid → triggered (entry touched) → tp1 → tp2 | stopped.
 * After TP1 the stop moves to breakeven. Returns a new object; never mutates.
 */
export function advanceSetup(setup: Setup, candle: Candle): SetupTransition {
  if (isTerminalStatus(setup.status)) return { setup, transition: null };
  const tfSec = TIMEFRAME_SECONDS[PLAYBOOKS[setup.playbook].entryTf];
  const nowSec = candle.time + tfSec;
  const at = isoFromSec(nowSec);
  const t = touches(setup, candle);

  if (setup.status === 'watching') {
    if (t.closedThroughZone) return { setup: close(setup, 'invalidated', null, at), transition: 'invalidated' };
    if (nowSec >= secFromIso(setup.expiresAt)) return { setup: close(setup, 'expired', null, at), transition: 'expired' };
    return { setup: { ...setup, updatedAt: at }, transition: null };
  }

  if (setup.status === 'valid') {
    if (!t.entry) {
      if (nowSec >= secFromIso(setup.expiresAt)) return { setup: close(setup, 'expired', null, at), transition: 'expired' };
      return { setup: { ...setup, updatedAt: at }, transition: null };
    }
    const triggered: Setup = { ...setup, status: 'triggered', triggeredAt: at, updatedAt: at, maxFavorableR: 0 };
    const resolved = resolveOpen(triggered, t, at);
    return { setup: withMfe(resolved.setup, candle), transition: resolved.transition ?? 'triggered' };
  }

  if (setup.status === 'triggered') {
    const resolved = resolveOpen(setup, t, at);
    return { setup: withMfe(resolved.setup, candle), transition: resolved.transition };
  }

  // tp1: stop is at breakeven
  if (t.breakeven) return { setup: close(setup, 'stopped', REALIZED_R.tp1ThenBreakeven, at), transition: 'stopped' };
  if (t.tp2) return { setup: withMfe(close(setup, 'tp2', REALIZED_R.tp2, at), candle), transition: 'tp2' };
  return { setup: withMfe({ ...setup, updatedAt: at }, candle), transition: null };
}

function withMfe(setup: Setup, candle: Candle): Setup {
  const r = rMultiple(setup.direction, setup.entry, setup.riskPts, bestPrice(setup, candle));
  const prev = setup.maxFavorableR ?? 0;
  return { ...setup, maxFavorableR: Math.max(prev, Math.round(r * 100) / 100) };
}

/** Advances every setup; returns new array plus the list of transitions that happened. */
export function advanceSetups(setups: readonly Setup[], candle: Candle): { setups: Setup[]; transitions: SetupTransition[] } {
  const results = setups.map((s) => advanceSetup(s, candle));
  return { setups: results.map((r) => r.setup), transitions: results.filter((r) => r.transition !== null) };
}

export type JournalStats = { count: number; wins: number; winRate: number | null; avgR: number | null; totalR: number };

/** Closed trades only (those that were triggered and have a realized R). */
export function journalStats(setups: readonly Setup[]): JournalStats {
  const closed = setups.filter((s) => s.closedAt !== undefined && s.realizedR !== undefined);
  const count = closed.length;
  if (count === 0) return { count: 0, wins: 0, winRate: null, avgR: null, totalR: 0 };
  const totalR = closed.reduce((acc, s) => acc + (s.realizedR ?? 0), 0);
  const wins = closed.filter((s) => (s.realizedR ?? 0) > 0).length;
  return { count, wins, winRate: wins / count, avgR: Math.round((totalR / count) * 100) / 100, totalR: Math.round(totalR * 100) / 100 };
}
