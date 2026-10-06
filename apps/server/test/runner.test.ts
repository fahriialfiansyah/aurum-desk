import { describe, expect, test } from 'vitest';
import { EngineRunner } from '../src/engine/runner';
import { MarketFeed } from '../src/market/feed';
import { EventLog } from '../src/state/event-log';
import { SetupStore } from '../src/state/setup-store';
import { realSample } from './helpers';

function boot(warmup: number) {
  const feed = new MarketFeed();
  const setups = new SetupStore();
  const events = new EventLog();
  const runner = new EngineRunner({ feed, setups, events });
  const m1 = realSample();
  feed.loadHistory(m1.slice(0, warmup));
  return { feed, setups, events, runner, rest: m1.slice(warmup) };
}

describe('EngineRunner on real data', () => {
  test('emits analysis snapshots and playbook results on M5/M15 closes', () => {
    const { feed, runner, rest } = boot(4000);
    const seen = { analysis: 0, playbook: 0, setup: 0 };
    for (const c of rest.slice(0, 60)) {
      const out = runner.handle(feed.push(c, true));
      for (const ev of out) seen[ev.type] += 1;
    }
    expect(seen.analysis).toBeGreaterThan(0);
    expect(seen.playbook).toBeGreaterThan(0);
    expect(runner.analysis('M5')).not.toBeNull();
    expect(runner.analysis('M15')).not.toBeNull();
    expect(runner.lastResult('scalp_m15_m5')).not.toBeNull();
  });

  test('creates setups, persists them in the store and drives them through the lifecycle', () => {
    const { feed, runner, setups, events, rest } = boot(4000);
    const transitions: string[] = [];
    let created = 0;
    for (const c of rest.slice(0, 6000)) {
      for (const ev of runner.handle(feed.push(c, true))) {
        if (ev.type !== 'setup') continue;
        if (ev.transition === 'watching' || ev.transition === 'valid') created += 1;
        if (ev.transition) transitions.push(ev.transition);
      }
    }
    expect(created).toBeGreaterThan(0);
    expect(transitions.length).toBeGreaterThan(0);
    const terminal = transitions.filter((t) => ['tp2', 'stopped', 'invalidated', 'expired'].includes(t));
    expect(terminal.length).toBeGreaterThan(0);
    expect(setups.journal.length + setups.active.length).toBeGreaterThan(0);
    expect(events.recent().some((e) => e.agent === 'system' && /Setup/.test(e.summary))).toBe(true);
    // every active setup is non-terminal; every journal entry is terminal
    expect(setups.active.every((s) => !['tp2', 'stopped', 'invalidated', 'expired'].includes(s.status))).toBe(true);
    expect(setups.journal.every((s) => ['tp2', 'stopped', 'invalidated', 'expired'].includes(s.status))).toBe(true);
  });

  test('runNow is deterministic and does not duplicate setups', () => {
    const { feed, runner, setups, rest } = boot(4000);
    for (const c of rest.slice(0, 300)) runner.handle(feed.push(c, true));
    const before = setups.active.map((s) => s.id);
    const a = runner.runNow('scalp_m15_m5');
    const b = runner.runNow('scalp_m15_m5');
    expect(a.result.best?.id).toBe(b.result.best?.id);
    expect(new Set(setups.active.map((s) => s.id)).size).toBe(setups.active.length);
    if (a.result.best) expect(setups.active.map((s) => s.id)).toContain(a.result.best.id);
    expect(setups.active.length).toBeGreaterThanOrEqual(before.length);
  });
});

describe('EngineRunner — setup id reuse', () => {
  test('a zone re-proposed after its setup ended gets a suffixed id, and keeps it while active', () => {
    const { feed, runner, setups, rest } = boot(4000);
    for (const c of rest.slice(0, 300)) runner.handle(feed.push(c, true));
    const active = setups.active[0];
    if (!active) return; // data-dependent
    // Force the active setup to a terminal state (as if it expired), then let the engine re-propose it.
    setups.replaceActive(setups.active.map((s) => (s.id === active.id ? { ...s, status: 'expired' as const, closedAt: s.updatedAt } : s)));
    expect(setups.journal.some((s) => s.id === active.id)).toBe(true);
    const first = runner.runNow(active.playbook).result.best;
    if (!first || `stp-${first.playbook}-${first.zone.id}` !== active.id) return; // engine chose another zone now
    const activeIds = setups.active.map((s) => s.id);
    expect(activeIds).toContain(`${active.id}~2`);
    runner.runNow(active.playbook);
    expect(setups.active.filter((s) => s.id.startsWith(active.id))).toHaveLength(1);
    expect(setups.journal.some((s) => s.id === active.id)).toBe(true); // journal entry preserved
  });
});
