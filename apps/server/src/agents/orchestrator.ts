import type { PlaybookResult } from '@aurum/engine';
import type { LLMProvider, SpendTracker } from '@aurum/llm';
import { PLAYBOOKS, isPriceInsideZone, type AgentName, type PlaybookId, type Setup, type Timeframe } from '@aurum/shared';
import type { RunnerEvent } from '../engine/runner';
import type { Logger } from '../logger';
import type { FeedEvent, MarketFeed } from '../market/feed';
import type { EventLog } from '../state/event-log';
import type { SetupStore } from '../state/setup-store';
import { runRiskAgent } from './risk-agent';
import { runStructureAgent } from './structure-agent';
import type { AgentContext, AgentOutcome } from './types';
import { runValidatorAgent } from './validator-agent';
import { runZonesAgent } from './zones-agent';

export type OrchestratorDeps = {
  llm: LLMProvider | null;
  spend: SpendTracker;
  events: EventLog;
  setups: SetupStore;
  feed: MarketFeed;
  env: { riskPercent: number; accountSize: number };
  /** Persist + broadcast a setup whose rationale changed. */
  onSetupUpdated: (setup: Setup) => void;
  logger: Logger;
};

type CycleJob = {
  structureTfs: Set<Timeframe>;
  playbooks: Map<PlaybookId, PlaybookResult>;
  validatorSetupIds: Set<string>;
  riskSetupIds: Set<string>;
};

const STRUCTURE_TFS: readonly Timeframe[] = ['M15', 'M30'];
const RATIONALE_MAX_CHARS = 1200;

function emptyJob(): CycleJob {
  return { structureTfs: new Set(), playbooks: new Map(), validatorSetupIds: new Set(), riskSetupIds: new Set() };
}

function mergeJobs(a: CycleJob, b: CycleJob): CycleJob {
  return {
    structureTfs: new Set([...a.structureTfs, ...b.structureTfs]),
    playbooks: new Map([...a.playbooks, ...b.playbooks]),
    validatorSetupIds: new Set([...a.validatorSetupIds, ...b.validatorSetupIds]),
    riskSetupIds: new Set([...a.riskSetupIds, ...b.riskSetupIds]),
  };
}

/**
 * Turns one candle-close batch into agent work and runs it off the hot path.
 * Runs are single-flight: a batch arriving while agents are busy is merged into the next run,
 * so a slow LLM can never make the queue grow without bound.
 */
export class AgentOrchestrator {
  private pending: CycleJob | null = null;
  private running: Promise<void> | null = null;
  private readonly ctx: AgentContext;
  /** Last summary per agent, so an unchanged conclusion is not re-logged every candle. */
  private readonly lastSummary = new Map<AgentName, string>();
  /** Validator fingerprint per setup: re-run only when status or pressure changed (saves LLM calls). */
  private readonly validated = new Map<string, string>();

  constructor(private readonly deps: OrchestratorDeps) {
    const { llm, spend, events } = deps;
    this.ctx = {
      llm,
      spend,
      allowLlm: () => llm !== null && spend.canSpend(),
      onLlmFallback: (agent, reason) => {
        events.record({ agent, level: 'warn', summary: `LLM gagal (${reason}) — memakai penjelasan rule-based`, source: 'rules' });
      },
    };
    for (const agent of ['structure', 'zones', 'validator', 'risk', 'copilot'] as const) {
      events.setAgentState(agent, { mode: llm ? 'llm' : 'rules' });
    }
  }

  /** Derives the agent work for one M1 close. Returns immediately; work runs asynchronously. */
  onCycle(feedEvents: readonly FeedEvent[], runnerEvents: readonly RunnerEvent[]): void {
    const job = this.buildJob(feedEvents, runnerEvents);
    if (job.structureTfs.size === 0 && job.playbooks.size === 0 && job.validatorSetupIds.size === 0 && job.riskSetupIds.size === 0) return;
    this.pending = this.pending ? mergeJobs(this.pending, job) : job;
    if (!this.running) this.running = this.drain();
  }

  /** Resolves when all queued work has finished (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private buildJob(feedEvents: readonly FeedEvent[], runnerEvents: readonly RunnerEvent[]): CycleJob {
    const job = emptyJob();
    const closed = new Set(feedEvents.filter((e) => e.closed).map((e) => e.tf));
    for (const tf of STRUCTURE_TFS) if (closed.has(tf)) job.structureTfs.add(tf);
    for (const ev of runnerEvents) {
      if (ev.type === 'playbook') job.playbooks.set(ev.playbook, ev.result);
      if (ev.type === 'setup' && ev.transition === 'valid') job.riskSetupIds.add(ev.setup.id);
    }
    // Validator: setups whose zone currently contains price, on their own entry-TF close.
    const price = this.deps.feed.lastPrice();
    if (price !== null) {
      for (const s of this.deps.setups.active) {
        const entryTf = PLAYBOOKS[s.playbook].entryTf;
        if (!closed.has(entryTf)) continue;
        if ((s.status === 'watching' || s.status === 'valid') && isPriceInsideZone(price, s.zone)) {
          const fingerprint = `${s.status}:${s.pressure?.score ?? 'none'}:${s.pressure?.patterns.join(',') ?? ''}`;
          if (this.validated.get(s.id) === fingerprint) continue;
          this.validated.set(s.id, fingerprint);
          job.validatorSetupIds.add(s.id);
        }
      }
    }
    return job;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        await this.runJob(job);
      }
    } finally {
      this.running = null;
      if (this.pending) this.running = this.drain();
    }
  }

  private async runJob(job: CycleJob): Promise<void> {
    this.deps.spend.beginCycle();
    for (const tf of job.structureTfs) {
      const snapshot = this.deps.feed.closedCandles(tf, 1)[0];
      const result = [...job.playbooks.values()].find((r) => r.higher.tf === tf || r.lower.tf === tf);
      const structure = result ? (result.higher.tf === tf ? result.higher.structure : result.lower.structure) : null;
      if (!structure || !snapshot) continue;
      await this.runAgent('structure', () => runStructureAgent({ tf, structure, lastClose: snapshot.close }, this.ctx));
    }
    for (const result of job.playbooks.values()) {
      const price = this.deps.feed.lastPrice() ?? 0;
      await this.runAgent('zones', () => runZonesAgent({ result, price }, this.ctx));
    }
    for (const id of job.validatorSetupIds) {
      const setup = this.deps.setups.byId(id);
      if (!setup) continue;
      const candles = this.deps.feed.closedCandles(PLAYBOOKS[setup.playbook].entryTf, 12);
      await this.runAgent('validator', () => runValidatorAgent({ setup, candles }, this.ctx));
    }
    for (const id of job.riskSetupIds) {
      const setup = this.deps.setups.byId(id);
      if (!setup) continue;
      const result = job.playbooks.get(setup.playbook);
      const atr = result?.lower.atr ?? null;
      await this.runAgent('risk', () =>
        runRiskAgent({ setup, atr, accountSize: this.deps.env.accountSize, riskPercent: this.deps.env.riskPercent }, this.ctx),
      );
    }
  }

  private async runAgent(agent: AgentName, fn: () => Promise<AgentOutcome>): Promise<void> {
    const { events, logger } = this.deps;
    events.setAgentState(agent, { state: 'running' });
    const started = Date.now();
    try {
      const outcome = await fn();
      if (this.lastSummary.get(agent) === outcome.summary) {
        events.setAgentState(agent, { state: 'idle', lastRunAt: new Date().toISOString() });
        return;
      }
      this.lastSummary.set(agent, outcome.summary);
      events.record({
        agent,
        level: outcome.level,
        summary: outcome.summary,
        detail: outcome.detail,
        setupId: outcome.setupId,
        source: outcome.source,
        tokens: outcome.tokens,
        durationMs: Date.now() - started,
      });
      if (outcome.rationale && outcome.setupId) this.attachRationale(outcome.setupId, outcome.rationale);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ agent, error: message }, 'agent gagal');
      events.record({ agent, level: 'error', summary: `Agen ${agent} gagal: ${message}`, source: 'rules', durationMs: Date.now() - started });
    }
  }

  /** Appends agent text to the setup's `rationale.llm` (bounded) and republishes the setup. */
  private attachRationale(setupId: string, text: string): void {
    const setup = this.deps.setups.byId(setupId);
    if (!setup) return;
    const previous = setup.rationale.llm ? `${setup.rationale.llm}\n` : '';
    const llm = `${previous}${text}`.slice(-RATIONALE_MAX_CHARS);
    if (llm === setup.rationale.llm) return;
    const updated: Setup = { ...setup, rationale: { ...setup.rationale, llm }, updatedAt: new Date().toISOString() };
    const others = this.deps.setups.active.filter((s) => s.id !== setupId);
    const isActive = this.deps.setups.active.some((s) => s.id === setupId);
    if (isActive) this.deps.setups.replaceActive([...others, updated]);
    this.deps.onSetupUpdated(updated);
  }
}
