import { runPlaybook, aggregateCandles } from '@aurum/engine';
import { SpendTracker, type CompleteOptions, type CompleteResult, type LLMProvider, type LlmMessage } from '@aurum/llm';
import type { Setup } from '@aurum/shared';
import pino from 'pino';
import { describe, expect, test } from 'vitest';
import { AgentOrchestrator } from '../src/agents/orchestrator';
import { describeRisk, riskChecks, runRiskAgent } from '../src/agents/risk-agent';
import { describeStructure, runStructureAgent } from '../src/agents/structure-agent';
import type { AgentContext } from '../src/agents/types';
import { describeValidation, runValidatorAgent } from '../src/agents/validator-agent';
import { describeZonePick, runZonesAgent } from '../src/agents/zones-agent';
import { EngineRunner } from '../src/engine/runner';
import { MarketFeed } from '../src/market/feed';
import { EventLog } from '../src/state/event-log';
import { SetupStore } from '../src/state/setup-store';
import { realSample } from './helpers';

class FakeLlm implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'fake';
  calls: Array<{ messages: LlmMessage[]; options: CompleteOptions }> = [];
  constructor(private readonly queue: Array<string | Error>) {}
  async complete(messages: LlmMessage[], options: CompleteOptions = {}): Promise<CompleteResult> {
    this.calls.push({ messages, options });
    const next = this.queue.shift() ?? '{}';
    if (next instanceof Error) throw next;
    return { text: next, toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'end', model: 'fake' };
  }
}

function ctx(llm: LLMProvider | null, perCycle = 10_000): AgentContext & { fallbacks: string[] } {
  const spend = new SpendTracker({ provider: llm ? 'anthropic' : 'none', model: llm?.model ?? null, maxTokensPerCycle: perCycle, dailyBudgetTokens: 1e9 });
  spend.beginCycle();
  const fallbacks: string[] = [];
  return { llm, spend, allowLlm: () => llm !== null && spend.canSpend(), onLlmFallback: (_a, r) => fallbacks.push(r), fallbacks };
}

const m1 = realSample().slice(0, 6000);
const m5 = aggregateCandles(m1, 'M5');
const m15 = aggregateCandles(m1, 'M15');
const m30 = aggregateCandles(m1, 'M30');
const now = m1[m1.length - 1]!.time + 60;
const resultB = runPlaybook('scalp_m15_m5', { higher: m15, lower: m5, nowSec: now });
const resultA = runPlaybook('intraday_m30_m15', { higher: m30, lower: m15, nowSec: now });

const validSetup: Setup = {
  id: 'stp-x',
  symbol: 'XAUUSD',
  playbook: 'scalp_m15_m5',
  direction: 'long',
  status: 'valid',
  bias: { tf: 'M15', trend: 'bullish', lastEvent: 'BOS', eventPrice: 4601.2 },
  zone: { id: 'M15-demand-1', tf: 'M15', type: 'demand', top: 4592.1, bottom: 4588.4, score: 78, fresh: true, pattern: 'DBR' },
  entry: 4592.1,
  stopLoss: 4587.9,
  tp1: 4598.4,
  tp2: 4600.5,
  riskPts: 4.2,
  rr: { tp1: 1.5, tp2: 2 },
  pressure: { score: 70, patterns: ['engulfing', 'rejection_wick'] },
  rationale: { deterministic: ['x'] },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe('rule-based agents (LLM_PROVIDER=none)', () => {
  test('structure narrative is Indonesian and mentions the engine trend', async () => {
    const input = { tf: 'M15' as const, structure: resultB.higher.structure, lastClose: m15[m15.length - 1]!.close };
    const text = describeStructure(input);
    expect(text.narrative).toMatch(/Struktur M15/);
    const outcome = await runStructureAgent(input, ctx(null));
    expect(outcome.source).toBe('rules');
    expect(outcome.summary).toContain(resultB.higher.structure.trend);
  });

  test('zones explanation covers the pick or the reason for none', async () => {
    const outcome = await runZonesAgent({ result: resultB, price: m5[m5.length - 1]!.close }, ctx(null));
    expect(outcome.source).toBe('rules');
    expect(outcome.summary).toMatch(/Playbook B/);
    expect(describeZonePick({ result: resultA, price: 0 })).toMatch(/Playbook A/);
  });

  test('validator mirrors the engine verdict', async () => {
    expect(describeValidation({ setup: validSetup, candles: [] }).verdict).toBe('valid');
    expect(describeValidation({ setup: { ...validSetup, status: 'watching', pressure: null }, candles: [] }).verdict).toBe('reject');
    const outcome = await runValidatorAgent({ setup: validSetup, candles: m5.slice(-6) }, ctx(null));
    expect(outcome.level).toBe('success');
    expect(outcome.rationale).toMatch(/Validator: valid/);
  });

  test('risk checks RR, SL placement, ATR sanity and position size', async () => {
    const r = riskChecks({ setup: validSetup, atr: 5, accountSize: 10_000, riskPercent: 1 });
    expect(r.ok).toBe(true);
    expect(r.lots).toBe(0.23);
    const bad = riskChecks({ setup: { ...validSetup, stopLoss: 4590 }, atr: 5, accountSize: 10_000, riskPercent: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.checks.find((c) => c.name === 'SL di luar zona')?.ok).toBe(false);
    expect(describeRisk({ setup: validSetup, atr: 5, accountSize: 10_000, riskPercent: 1 })).toMatch(/Risk OK · 0.23 lot/);
    const outcome = await runRiskAgent({ setup: validSetup, atr: 5, accountSize: 10_000, riskPercent: 1 }, ctx(null));
    expect(outcome.level).toBe('success');
  });
});

describe('LLM-backed agents', () => {
  test('structure agent uses the model output and records spend', async () => {
    const llm = new FakeLlm(['{"trend":"bearish","narrative":"Struktur turun, LH/LL berturut.","confidence":0.7}']);
    const c = ctx(llm);
    const input = { tf: 'M15' as const, structure: { ...resultB.higher.structure, trend: 'bearish' as const }, lastClose: 1 };
    const outcome = await runStructureAgent(input, c);
    expect(outcome.source).toBe('llm');
    expect(outcome.tokens).toEqual({ input: 100, output: 20 });
    expect(c.spend.snapshot().calls).toBe(1);
    expect(llm.calls[0]?.options.system).toMatch(/jangan pernah menyebut level harga/i);
  });

  test('disagreement with the engine is flagged, never adopted', async () => {
    const llm = new FakeLlm(['{"trend":"bullish","narrative":"n","confidence":0.5}']);
    const outcome = await runStructureAgent({ tf: 'M15', structure: { ...resultB.higher.structure, trend: 'bearish' }, lastClose: 1 }, ctx(llm));
    expect(outcome.level).toBe('warn');
    expect(outcome.summary).toMatch(/engine bearish/);
  });

  test('invalid output twice → rule-based fallback with a warning', async () => {
    const llm = new FakeLlm(['garbage', 'still garbage']);
    const c = ctx(llm);
    const outcome = await runStructureAgent({ tf: 'M15', structure: resultB.higher.structure, lastClose: 1 }, c);
    expect(outcome.source).toBe('rules');
    expect(c.fallbacks).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
  });

  test('zones agent rejects a pick outside the candidate list, then falls back', async () => {
    if (!resultB.best) return;
    const llm = new FakeLlm(['{"pickZoneId":"nope","agreesWithEngine":true,"reasoning":"x"}', '{"pickZoneId":"nope","agreesWithEngine":true,"reasoning":"x"}']);
    const c = ctx(llm);
    const outcome = await runZonesAgent({ result: resultB, price: 1 }, c);
    expect(outcome.source).toBe('rules');
    expect(c.fallbacks).toHaveLength(1);
  });

  test('per-cycle token cap turns the LLM off for the rest of the cycle', async () => {
    const llm = new FakeLlm(['{"trend":"bullish","narrative":"a","confidence":0.5}', '{"trend":"bullish","narrative":"b","confidence":0.5}']);
    const c = ctx(llm, 100); // first call costs 120 tokens → cap exceeded
    const first = await runStructureAgent({ tf: 'M15', structure: { ...resultB.higher.structure, trend: 'bullish' }, lastClose: 1 }, c);
    const second = await runStructureAgent({ tf: 'M30', structure: { ...resultB.higher.structure, trend: 'bullish' }, lastClose: 1 }, c);
    expect(first.source).toBe('llm');
    expect(second.source).toBe('rules');
  });
});

describe('AgentOrchestrator', () => {
  test('runs structure/zones agents per cycle and attaches rationale to setups (rule-based)', async () => {
    const feed = new MarketFeed();
    const setups = new SetupStore();
    const events = new EventLog();
    const runner = new EngineRunner({ feed, setups, events });
    const updated: Setup[] = [];
    const all = realSample();
    feed.loadHistory(all.slice(0, 4000));
    const spend = new SpendTracker({ provider: 'none', model: null, maxTokensPerCycle: 1000, dailyBudgetTokens: 1000 });
    const orch = new AgentOrchestrator({
      llm: null,
      spend,
      events,
      setups,
      feed,
      env: { riskPercent: 1, accountSize: 10_000 },
      onSetupUpdated: (s) => updated.push(s),
      logger: pino({ level: 'silent' }),
    });
    for (const c of all.slice(4000, 4400)) {
      const feedEvents = feed.push(c, true);
      const runnerEvents = runner.handle(feedEvents);
      orch.onCycle(feedEvents, runnerEvents);
    }
    await orch.idle();
    const agents = new Set(events.recent(500).map((e) => e.agent));
    expect(agents.has('structure')).toBe(true);
    // identical conclusions are not re-logged on every candle
    const zoneSummaries = events.recent(500).filter((e) => e.agent === 'zones').map((e) => e.summary);
    for (let i = 1; i < zoneSummaries.length; i += 1) expect(zoneSummaries[i]).not.toBe(zoneSummaries[i - 1]);
    expect(agents.has('zones')).toBe(true);
    expect(events.agentStates().find((a) => a.agent === 'zones')?.mode).toBe('rules');
    expect(events.agentStates().find((a) => a.agent === 'zones')?.runs).toBeGreaterThan(0);
    if (setups.all().length > 0) {
      expect(updated.length).toBeGreaterThan(0);
      expect(updated[0]?.rationale.llm).toBeTruthy();
    }
  });

  test('coalesces cycles while a slow agent is running', async () => {
    const feed = new MarketFeed();
    const setups = new SetupStore();
    const events = new EventLog();
    const runner = new EngineRunner({ feed, setups, events });
    const all = realSample();
    feed.loadHistory(all.slice(0, 4000));
    const slot: { resolve: (() => void) | null } = { resolve: null };
    const slow = new (class implements LLMProvider {
      readonly name = 'anthropic' as const;
      readonly model = 'slow';
      calls = 0;
      async complete(): Promise<CompleteResult> {
        this.calls += 1;
        await new Promise<void>((r) => {
          slot.resolve = r;
        });
        return { text: '{"trend":"bullish","narrative":"n","confidence":0.5}', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end', model: 'slow' };
      }
    })();
    const orch = new AgentOrchestrator({
      llm: slow,
      spend: new SpendTracker({ provider: 'anthropic', model: 'slow', maxTokensPerCycle: 1e6, dailyBudgetTokens: 1e9 }),
      events,
      setups,
      feed,
      env: { riskPercent: 1, accountSize: 10_000 },
      onSetupUpdated: () => undefined,
      logger: pino({ level: 'silent' }),
    });
    // Feed 90 minutes: several M15 closes arrive while the first structure call is still pending.
    for (const c of all.slice(4000, 4090)) {
      const fe = feed.push(c, true);
      orch.onCycle(fe, runner.handle(fe));
    }
    expect(slow.calls).toBe(1);
    for (let i = 0; i < 50 && slow.calls < 3; i += 1) {
      slot.resolve?.();
      slot.resolve = null;
      await new Promise((r) => setTimeout(r, 0));
    }
    // Pending work was merged into at most one extra run per agent type rather than one per candle.
    expect(slow.calls).toBeLessThan(10);
  }, 20_000);
});
