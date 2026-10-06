import type { CompleteOptions, CompleteResult, LLMProvider, LlmMessage } from '@aurum/llm';
import { SpendTracker } from '@aurum/llm';
import type { Drawing, Setup, WsServerMessage } from '@aurum/shared';
import pino from 'pino';
import { describe, expect, test, vi } from 'vitest';
import { createAlertService, formatAlert } from '../src/alerts/telegram-alerts';
import { Copilot } from '../src/copilot/copilot';
import { DrawingStore } from '../src/copilot/drawings';
import { answerWithRules } from '../src/copilot/rules';
import { buildTools, knownLevels } from '../src/copilot/tools';
import { EngineRunner } from '../src/engine/runner';
import { MarketFeed } from '../src/market/feed';
import { computeMetrics } from '../src/metrics';
import { EventLog } from '../src/state/event-log';
import { SetupStore } from '../src/state/setup-store';
import { realSample } from './helpers';

class ScriptedLlm implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'fake';
  calls: Array<{ messages: LlmMessage[]; options: CompleteOptions }> = [];
  constructor(private readonly queue: Array<Partial<CompleteResult> | Error>) {}
  async complete(messages: LlmMessage[], options: CompleteOptions = {}): Promise<CompleteResult> {
    this.calls.push({ messages, options });
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    const text = next?.text ?? '';
    for (const ch of text.match(/.{1,6}/g) ?? []) options.onToken?.(ch);
    return { text, toolCalls: [], usage: { inputTokens: 50, outputTokens: 10 }, stopReason: 'end', model: 'fake', ...next };
  }
}

function desk() {
  const feed = new MarketFeed();
  const setups = new SetupStore();
  const events = new EventLog();
  const runner = new EngineRunner({ feed, setups, events });
  const all = realSample();
  feed.loadHistory(all.slice(0, 4000));
  for (const c of all.slice(4000, 4600)) runner.handle(feed.push(c, true));
  const drawings = new DrawingStore();
  const published: WsServerMessage[] = [];
  const runnerEvents: unknown[] = [];
  const metrics = () =>
    computeMetrics({
      symbol: 'XAUUSD',
      feed,
      setups,
      feedStatus: () => ({ provider: 'replay', isMock: false, source: 'csv', connected: true, lastCandleTime: null, lagSec: null }),
      llmSpend: () => ({ inputTokens: 0, outputTokens: 0, calls: 0, estimatedUsd: 0, dailyBudgetTokens: 1, provider: 'none', model: null }),
      nowSec: () => 0,
    });
  const tools = buildTools({
    feed,
    runner,
    setups,
    drawings,
    metrics,
    onRunnerEvents: (e) => runnerEvents.push(...e),
    onDrawing: (action, drawing, drawingId) => published.push({ type: 'drawing', action, drawing, drawingId }),
  });
  return { feed, setups, events, runner, drawings, tools, published, runnerEvents, metrics };
}

const tool = (tools: ReturnType<typeof buildTools>, name: string) => tools.find((t) => t.def.name === name)!;

describe('copilot tools', () => {
  test('read tools return engine data as JSON', async () => {
    const d = desk();
    const candles = JSON.parse((await tool(d.tools, 'getCandles').run({ tf: 'M5', n: 5 })).content);
    expect(candles.candles).toHaveLength(5);
    const structure = JSON.parse((await tool(d.tools, 'getStructure').run({ tf: 'M15' })).content);
    expect(['bullish', 'bearish', 'ranging']).toContain(structure.trend);
    const zones = JSON.parse((await tool(d.tools, 'getZones').run({ tf: 'M15' })).content);
    expect(Array.isArray(zones.zones)).toBe(true);
    const setups = JSON.parse((await tool(d.tools, 'getSetups').run({})).content);
    expect(setups).toHaveProperty('active');
    await expect(tool(d.tools, 'getCandles').run({ tf: 'H1' })).rejects.toThrow();
    await expect(tool(d.tools, 'explainSetup').run({ id: 'nope' })).rejects.toThrow(/tidak ditemukan/);
  });

  test('runPlaybook triggers the runner and publishes its events', async () => {
    const d = desk();
    const out = await tool(d.tools, 'runPlaybook').run({ playbook: 'scalp_m15_m5' });
    expect(out.summary).toMatch(/B:/);
    expect(d.runnerEvents.length).toBeGreaterThan(0);
  });

  test('drawAnnotation only accepts prices the engine knows; box + remove + clear work', async () => {
    const d = desk();
    const levels = knownLevels({ runner: d.runner, setups: d.setups });
    expect(levels.length).toBeGreaterThan(0);
    const draw = tool(d.tools, 'drawAnnotation');
    await expect(draw.run({ kind: 'hline', price: 1234.56, label: 'x' })).rejects.toThrow(/bukan level yang dikenal/);
    const known = levels[0]!;
    const ok = JSON.parse((await draw.run({ kind: 'hline', price: known, label: 'level' })).content) as { drawing: Drawing };
    expect(ok.drawing.kind).toBe('hline');
    expect(d.drawings.all()).toHaveLength(1);
    expect(d.published[0]).toMatchObject({ type: 'drawing', action: 'add' });
    const [a, b] = levels;
    const box = JSON.parse((await draw.run({ kind: 'box', top: a, bottom: b ?? a })).content) as { drawing: Drawing };
    expect(box.drawing.kind).toBe('box');
    const removed = await tool(d.tools, 'removeAnnotation').run({ id: ok.drawing.id });
    expect(JSON.parse(removed.content).ok).toBe(true);
    await tool(d.tools, 'removeAnnotation').run({ all: true });
    expect(d.drawings.all()).toHaveLength(0);
  });
});

describe('rule-based copilot', () => {
  test('answers the four canonical questions in Indonesian', async () => {
    const d = desk();
    const deps = { runner: d.runner, setups: d.setups, feed: d.feed, tools: d.tools };
    expect((await answerWithRules('bias M30 sekarang?', deps)).text).toMatch(/Struktur M30/);
    expect((await answerWithRules('zona demand terdekat?', deps)).text).toMatch(/Zona demand M15|Tidak ada zona/);
    const run = await answerWithRules('jalankan playbook B', deps);
    expect(run.text).toMatch(/Playbook B dijalankan/);
    expect(run.toolsUsed).toEqual(['runPlaybook']);
    const why = await answerWithRules('kenapa setup ini valid?', deps);
    expect(why.text).toMatch(/Setup|Belum ada setup/);
    expect((await answerWithRules('halo', deps)).text).toMatch(/rule-based/);
  });

  test('prefers the focused setup when the client passes its id', async () => {
    const d = desk();
    const setup = d.setups.all()[0];
    if (!setup) return;
    const why = await answerWithRules(`kenapa setup ini valid?\n\n[setup fokus: ${setup.id}]`, { runner: d.runner, setups: d.setups, feed: d.feed, tools: d.tools });
    expect(why.text).toContain(setup.rationale.deterministic[0]!);
  });
});

describe('Copilot (LLM tool loop)', () => {
  function copilotWith(llm: LLMProvider | null) {
    const d = desk();
    const published: WsServerMessage[] = [];
    const persisted: Array<[string, string]> = [];
    const spend = new SpendTracker({ provider: llm ? 'anthropic' : 'none', model: llm?.model ?? null, maxTokensPerCycle: 100_000, dailyBudgetTokens: 1e9 });
    spend.beginCycle();
    const copilot = new Copilot({
      llm,
      spend,
      tools: d.tools,
      events: d.events,
      publish: (m) => published.push(m),
      persist: (cid, m) => persisted.push([cid, m.role]),
      context: () => 'ctx',
      rules: { runner: d.runner, setups: d.setups, feed: d.feed, tools: d.tools },
      logger: pino({ level: 'silent' }),
    });
    return { copilot, published, persisted, spend, d };
  }

  const waitFor = async (pred: () => boolean) => {
    for (let i = 0; i < 100 && !pred(); i += 1) await new Promise((r) => setTimeout(r, 5));
  };

  test('streams tokens, executes tool calls, feeds results back, and persists both turns', async () => {
    const llm = new ScriptedLlm([
      { text: 'Saya cek dulu. ', toolCalls: [{ id: 'c1', name: 'getStructure', args: { tf: 'M15' } }], stopReason: 'tool_use' },
      { text: 'Bias M15 sesuai data tool.' },
    ]);
    const { copilot, published, persisted, spend } = copilotWith(llm);
    const { messageId } = await copilot.handle({ message: 'bias M15?' });
    await waitFor(() => published.some((m) => m.type === 'chatMessage'));
    const tokens = published.filter((m) => m.type === 'chatToken' && m.messageId === messageId);
    expect(tokens.some((m) => m.type === 'chatToken' && m.token)).toBe(true);
    const chips = tokens.filter((m) => m.type === 'chatToken' && m.toolCall).map((m) => (m.type === 'chatToken' ? m.toolCall!.status : ''));
    expect(chips).toEqual(['running', 'done']);
    const final = published.find((m) => m.type === 'chatMessage');
    expect(final?.type === 'chatMessage' && final.message.content).toBe('Saya cek dulu. Bias M15 sesuai data tool.');
    expect(final?.type === 'chatMessage' && final.message.source).toBe('llm');
    expect(llm.calls[1]?.messages.some((m) => m.role === 'tool')).toBe(true);
    expect(llm.calls[0]?.options.tools?.map((t) => t.name)).toContain('drawAnnotation');
    expect(spend.snapshot().calls).toBe(2);
    expect(persisted).toEqual([['default', 'user'], ['default', 'assistant']]);
  });

  test('unknown tool and tool errors are reported back to the model, not thrown', async () => {
    const llm = new ScriptedLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'nope', args: {} }, { id: 'c2', name: 'drawAnnotation', args: { kind: 'hline', price: 1 } }], stopReason: 'tool_use' },
      { text: 'Maaf, level tidak dikenal.' },
    ]);
    const { copilot, published } = copilotWith(llm);
    await copilot.handle({ message: 'gambar garis di 1' });
    await waitFor(() => published.some((m) => m.type === 'chatMessage'));
    const errors = published.filter((m) => m.type === 'chatToken' && m.toolCall?.status === 'error');
    expect(errors).toHaveLength(2);
    expect(llm.calls[1]?.messages.filter((m) => m.role === 'tool')).toHaveLength(2);
  });

  test('falls back to rule-based when the LLM errors, and when no LLM is configured', async () => {
    const { copilot, published } = copilotWith(new ScriptedLlm([new (class extends Error {})('boom')]));
    await copilot.handle({ message: 'bias M30?' });
    await waitFor(() => published.some((m) => m.type === 'chatMessage'));
    const none = copilotWith(null);
    await none.copilot.handle({ message: 'bias M30?' });
    await waitFor(() => none.published.some((m) => m.type === 'chatMessage'));
    const final = none.published.find((m) => m.type === 'chatMessage');
    expect(final?.type === 'chatMessage' && final.message.source).toBe('rules');
    expect(final?.type === 'chatMessage' && final.message.content).toMatch(/Struktur M30/);
    expect(none.published.filter((m) => m.type === 'chatToken' && m.token).length).toBeGreaterThan(1);
  });
});

describe('Telegram alerts', () => {
  const setup: Setup = {
    id: 's1',
    symbol: 'XAUUSD',
    playbook: 'scalp_m15_m5',
    direction: 'long',
    status: 'valid',
    bias: { tf: 'M15', trend: 'bullish', lastEvent: 'BOS', eventPrice: 1 },
    zone: { id: 'z', tf: 'M15', type: 'demand', top: 4592.1, bottom: 4588.4, score: 78, fresh: true, pattern: 'DBR' },
    entry: 4592.1,
    stopLoss: 4587.9,
    tp1: 4598.4,
    tp2: 4600.5,
    riskPts: 4.2,
    rr: { tp1: 1.5, tp2: 2 },
    pressure: null,
    rationale: { deterministic: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
  };

  test('formats an Indonesian alert with exact levels and the disclaimer', () => {
    const text = formatAlert(setup, 'valid');
    expect(text).toMatch(/Setup VALID — XAUUSD B LONG/);
    expect(text).toContain('Entry 4592.10 · SL 4587.90');
    expect(text).toContain('TP1 4598.40 (1:1.5) · TP2 4600.50 (1:2)');
    expect(text).toMatch(/Bukan saran finansial/);
  });

  test('sends only alert-worthy transitions once, and is a no-op without config', async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    const svc = createAlertService({ botToken: 't', chatId: 'c' }, pino({ level: 'silent' }), send);
    svc.notify(setup, 'valid');
    svc.notify(setup, 'valid');
    svc.notify(setup, 'watching');
    svc.notify(setup, null);
    svc.notify({ ...setup, status: 'tp2', realizedR: 1.75 }, 'tp2');
    await new Promise((r) => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(2);
    expect(createAlertService({}, pino({ level: 'silent' }), send).enabled).toBe(false);
  });
});
