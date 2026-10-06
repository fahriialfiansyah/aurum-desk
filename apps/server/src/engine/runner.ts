import {
  advanceSetups,
  reconcileSetups,
  runPlaybook,
  type EngineParams,
  type PlaybookResult,
  type SetupTransition,
} from '@aurum/engine';
import { PLAYBOOKS, PLAYBOOK_IDS, TIMEFRAME_SECONDS, formatPrice, isoFromSec, type AnalysisSnapshot, type Candle, type PlaybookId, type Setup, type SetupStatus, type Timeframe } from '@aurum/shared';
import type { MarketFeed, FeedEvent } from '../market/feed';
import type { EventLog } from '../state/event-log';
import type { SetupStore } from '../state/setup-store';

export type RunnerEvent =
  | { type: 'analysis'; snapshot: AnalysisSnapshot }
  | { type: 'setup'; setup: Setup; transition: SetupStatus | null }
  | { type: 'playbook'; playbook: PlaybookId; result: PlaybookResult; candle: Candle };

export type RunnerDeps = {
  feed: MarketFeed;
  setups: SetupStore;
  events: EventLog;
  params?: Partial<EngineParams>;
  /** Max closed bars handed to the engine per timeframe (keeps each run O(window)). */
  window?: number;
};

const DEFAULT_WINDOW = 600;
const STATUS_LABEL_ID: Record<SetupStatus, string> = {
  watching: 'menunggu harga masuk zona',
  valid: 'VALID — konfirmasi pressure',
  triggered: 'TRIGGERED — entry tersentuh',
  tp1: 'TP1 tercapai',
  tp2: 'TP2 tercapai',
  stopped: 'STOP LOSS',
  invalidated: 'zona ditembus — setup batal',
  expired: 'kedaluwarsa tanpa trigger',
};

/**
 * Drives the deterministic engine from feed events: lifecycle on each entry-TF close, then the
 * playbook, then reconciliation with the active setups. Synchronous and side-effect free apart from
 * the stores it owns; everything it decides is returned as events for the WS hub / agents.
 */
export class EngineRunner {
  private readonly feed: MarketFeed;
  private readonly setups: SetupStore;
  private readonly events: EventLog;
  private readonly params: Partial<EngineParams>;
  private readonly window: number;
  private snapshots = new Map<Timeframe, AnalysisSnapshot>();
  private lastResults = new Map<PlaybookId, PlaybookResult>();
  /** base setup id → active alias, so a zone re-proposed after an earlier (terminal) setup gets a fresh id. */
  private readonly aliases = new Map<string, string>();

  constructor(deps: RunnerDeps) {
    this.feed = deps.feed;
    this.setups = deps.setups;
    this.events = deps.events;
    this.params = deps.params ?? {};
    this.window = deps.window ?? DEFAULT_WINDOW;
  }

  analysis(tf: Timeframe): AnalysisSnapshot | null {
    return this.snapshots.get(tf) ?? null;
  }

  analyses(): AnalysisSnapshot[] {
    return [...this.snapshots.values()];
  }

  lastResult(id: PlaybookId): PlaybookResult | null {
    return this.lastResults.get(id) ?? null;
  }

  /** Handles the batch of feed events produced by ONE closed M1 bar. */
  handle(feedEvents: readonly FeedEvent[]): RunnerEvent[] {
    const closedTfs = new Set(feedEvents.filter((e) => e.closed).map((e) => e.tf));
    const out: RunnerEvent[] = [];
    for (const id of PLAYBOOK_IDS) {
      const entryTf = PLAYBOOKS[id].entryTf;
      if (!closedTfs.has(entryTf)) continue;
      const candle = feedEvents.find((e) => e.tf === entryTf && e.closed)?.candle;
      if (!candle) continue;
      out.push(...this.advance(id, candle));
      out.push(...this.run(id, candle));
    }
    return out;
  }

  /** Runs one playbook on demand (REST / copilot). Reconciles like a scheduled run. */
  runNow(id: PlaybookId): { result: PlaybookResult; events: RunnerEvent[] } {
    const entryTf = PLAYBOOKS[id].entryTf;
    const last = this.feed.closedCandles(entryTf, 1)[0];
    if (!last) {
      const result = runPlaybook(id, { higher: [], lower: [], nowSec: 0 }, this.params);
      return { result, events: [] };
    }
    const events = this.run(id, last);
    const result = this.lastResults.get(id)!;
    return { result, events };
  }

  private advance(id: PlaybookId, candle: Candle): RunnerEvent[] {
    const mine = this.setups.active.filter((s) => s.playbook === id);
    if (mine.length === 0) return [];
    const { setups, transitions } = advanceSetups(mine, candle);
    const others = this.setups.active.filter((s) => s.playbook !== id);
    this.setups.replaceActive([...others, ...setups]);
    return transitions.map((t) => this.toSetupEvent(t));
  }

  private run(id: PlaybookId, candle: Candle): RunnerEvent[] {
    const { biasTf, entryTf } = PLAYBOOKS[id];
    const higher = this.feed.closedCandles(biasTf, this.window);
    const lower = this.feed.closedCandles(entryTf, this.window);
    const nowSec = candle.time + TIMEFRAME_SECONDS[entryTf];
    const result = runPlaybook(id, { higher, lower, nowSec }, this.params);
    this.lastResults.set(id, result);

    const computedAt = isoFromSec(nowSec);
    const out: RunnerEvent[] = [];
    for (const side of [result.higher, result.lower]) {
      const snapshot: AnalysisSnapshot = { tf: side.tf, structure: side.structure, zones: side.zones, atr: side.atr, computedAt };
      this.snapshots.set(side.tf, snapshot);
      out.push({ type: 'analysis', snapshot });
    }
    out.push({ type: 'playbook', playbook: id, result, candle });

    const before = new Map(this.setups.active.map((s) => [s.id, s] as const));
    const proposed = result.best ? [this.withUniqueId(result.best)] : [];
    const next = reconcileSetups(this.setups.active, proposed);
    const changed = this.setups.replaceActive(next);
    for (const s of changed) {
      const prev = before.get(s.id);
      const transition: SetupStatus | null = prev?.status === s.status ? null : s.status;
      if (!prev || transition) out.push(this.toSetupEvent({ setup: s, transition: prev ? transition : s.status }, !prev));
    }
    return out;
  }

  /**
   * Deterministic ids collide when the same zone produces a setup again after the first one
   * expired/stopped. Keep the base id while a setup is active; otherwise suffix `~n` and remember it.
   */
  private withUniqueId(setup: Setup): Setup {
    const base = setup.id;
    const active = this.setups.active;
    if (active.some((s) => s.id === base)) return setup;
    const alias = this.aliases.get(base);
    if (alias && active.some((s) => s.id === alias)) return { ...setup, id: alias };
    const taken = new Set(this.setups.all().map((s) => s.id));
    if (!taken.has(base)) {
      this.aliases.delete(base);
      return setup;
    }
    let n = 2;
    while (taken.has(`${base}~${n}`)) n += 1;
    const id = `${base}~${n}`;
    this.aliases.set(base, id);
    return { ...setup, id };
  }

  private toSetupEvent(t: SetupTransition, isNew = false): RunnerEvent {
    const s = t.setup;
    const label = PLAYBOOKS[s.playbook].shortLabel;
    const dir = s.direction === 'long' ? 'LONG' : 'SHORT';
    const summary = isNew
      ? `Setup ${label} ${dir} @ ${formatPrice(s.entry)} dibuat — ${STATUS_LABEL_ID[s.status]}`
      : `Setup ${label} ${dir} @ ${formatPrice(s.entry)} → ${STATUS_LABEL_ID[t.transition ?? s.status]}`;
    const level = t.transition === 'stopped' ? 'warn' : t.transition === 'tp1' || t.transition === 'tp2' || t.transition === 'valid' ? 'success' : 'info';
    this.events.record({ agent: 'system', level, summary, setupId: s.id, tf: s.zone.tf, source: 'rules' });
    return { type: 'setup', setup: s, transition: t.transition };
  }
}
