import { SpendTracker, createLlmProvider, type LlmConfig } from '@aurum/llm';
import { SESSION_LABEL_ID, formatPrice, nowSec, type LlmSpend, type WsServerMessage } from '@aurum/shared';
import { AgentOrchestrator } from './agents/orchestrator';
import { createAlertService } from './alerts/telegram-alerts';
import { loadServerEnv, type ServerEnv } from './config/env';
import { Copilot } from './copilot/copilot';
import { DrawingStore } from './copilot/drawings';
import { buildTools } from './copilot/tools';
import { EngineRunner, type RunnerEvent } from './engine/runner';
import { buildApp } from './http/app';
import { createLogger } from './logger';
import { MarketFeed } from './market/feed';
import { computeMetrics } from './metrics';
import { createLiveProvider } from './providers';
import { EventLog } from './state/event-log';
import { createPersistence } from './state/persistence';
import { SetupStore } from './state/setup-store';

const METRICS_INTERVAL_MS = 1000;
const HELLO_CANDLES = 1500;

function llmConfigFromEnv(env: ServerEnv): LlmConfig {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY ?? '', model: env.ANTHROPIC_MODEL };
    case 'openai':
      return { provider: 'openai', apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_MODEL };
    case 'ollama':
      return { provider: 'ollama', baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL };
    default:
      return { provider: 'none' };
  }
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV !== 'production');
  const persistence = await createPersistence(env.DATABASE_URL, logger);
  const provider = await createLiveProvider(env, persistence.db);
  if (provider.isMock) logger.warn('MARKET_DATA_PROVIDER=mock — DATA SINTETIS, bukan harga pasar.');

  const feed = new MarketFeed();
  const setups = new SetupStore();
  const events = new EventLog();
  const runner = new EngineRunner({ feed, setups, events });

  const history = await provider.warmup(env.REPLAY_WARMUP_BARS);
  feed.loadHistory(history);
  const stored = await persistence.loadSetups();
  setups.load(stored.active, stored.journal);
  events.load(await persistence.loadEvents(200));
  logger.info({ provider: provider.name, warmup: history.length, candles: feed.size(), persistence: persistence.mode }, 'feed siap');

  const llm = createLlmProvider(llmConfigFromEnv(env));
  const spend = new SpendTracker({
    provider: llm ? llm.name : 'none',
    model: llm?.model ?? null,
    maxTokensPerCycle: env.LLM_MAX_TOKENS_PER_CYCLE,
    dailyBudgetTokens: env.LLM_DAILY_TOKEN_BUDGET,
  });
  const llmSpend = (): LlmSpend => {
    const snap = spend.snapshot();
    return {
      inputTokens: snap.inputTokens,
      outputTokens: snap.outputTokens,
      calls: snap.calls,
      estimatedUsd: snap.estimatedUsd,
      dailyBudgetTokens: snap.dailyBudgetTokens,
      provider: snap.provider,
      model: snap.model,
    };
  };
  logger.info({ llm: llm ? `${llm.name}/${llm.model}` : 'none (rule-based)' }, 'LLM siap');
  const metrics = () =>
    computeMetrics({ symbol: env.SYMBOL, feed, setups, feedStatus: () => provider.status(), llmSpend, nowSec });

  const hello = (): WsServerMessage[] => [
    { type: 'hello', serverTime: new Date().toISOString(), symbol: env.SYMBOL, feed: provider.status(), activePlaybook: 'scalp_m15_m5' },
    ...(['M1', 'M5', 'M15', 'M30'] as const).map((tf) => ({ type: 'candles' as const, tf, candles: feed.candlesWithForming(tf, HELLO_CANDLES) })),
    ...runner.analyses().map((snapshot) => ({ type: 'analysis' as const, snapshot })),
    { type: 'setups', setups: [...setups.active, ...setups.journal.slice(0, 50)] },
    { type: 'agentStates', states: events.agentStates() },
    ...drawings.all().map((drawing) => ({ type: 'drawing' as const, action: 'add' as const, drawing })),
    ...events.recent(100).map((event) => ({ type: 'agentEvent' as const, event })),
    { type: 'metrics', metrics: metrics() },
  ];

  const alerts = createAlertService({ botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }, logger);
  const publishRunnerEvents = (runnerEvents: RunnerEvent[]) => {
    for (const ev of runnerEvents) {
      if (ev.type === 'analysis') hub.broadcast({ type: 'analysis', snapshot: ev.snapshot });
      if (ev.type === 'setup') {
        hub.broadcast({ type: 'setup', setup: ev.setup, transition: ev.transition });
        void persistence.saveSetup(ev.setup);
        alerts.notify(ev.setup, ev.transition);
      }
    }
  };
  const onRunnerEvents = (runnerEvents: RunnerEvent[]) => {
    publishRunnerEvents(runnerEvents);
    orchestrator.onCycle([], runnerEvents);
  };

  const drawings = new DrawingStore();
  const tools = buildTools({
    feed,
    runner,
    setups,
    drawings,
    metrics,
    onRunnerEvents,
    onDrawing: (action, drawing, drawingId) => hub.broadcast({ type: 'drawing', action, drawing, drawingId }),
  });
  const copilot = new Copilot({
    llm,
    spend,
    tools,
    events,
    publish: (message) => hub.broadcast(message),
    persist: (conversationId, message) => void persistence.saveChat(conversationId, message),
    context: () => {
      const m = metrics();
      const active = setups.active.map((s) => `${s.id} ${s.direction} ${s.status} entry ${formatPrice(s.entry)}`).join('; ') || 'tidak ada';
      return `harga ${m.lastPrice === null ? '—' : formatPrice(m.lastPrice)}, sesi ${SESSION_LABEL_ID[m.session]}, ATR M15 ${m.atrM15?.toFixed(2) ?? '—'}, setup aktif: ${active}`;
    },
    rules: { runner, setups, feed, tools },
    logger,
  });

  let publishSetup: (setup: typeof setups.active[number]) => void = () => undefined;
  const orchestrator = new AgentOrchestrator({
    llm,
    spend,
    events,
    setups,
    feed,
    env: { riskPercent: env.RISK_PERCENT, accountSize: env.ACCOUNT_SIZE },
    onSetupUpdated: (setup) => publishSetup(setup),
    logger,
  });

  const { app, hub } = await buildApp({
    env,
    logger,
    feed,
    runner,
    setups,
    events,
    provider,
    metrics,
    hello,
    onRunnerEvents,
    chat: (request) => copilot.handle(request),
  });
  publishSetup = (setup) => {
    hub.broadcast({ type: 'setup', setup, transition: null });
    void persistence.saveSetup(setup);
  };
  events.subscribe((event) => {
    hub.broadcast({ type: 'agentEvent', event });
    hub.broadcast({ type: 'agentStates', states: events.agentStates() });
    void persistence.saveEvent(event);
  });

  await provider.start((candle, meta) => {
    try {
      const feedEvents = feed.push(candle, meta.closed);
      for (const ev of feedEvents) hub.broadcast({ type: 'candle', tf: ev.tf, candle: ev.candle, closed: ev.closed });
      if (!meta.closed) return;
      const runnerEvents = runner.handle(feedEvents);
      publishRunnerEvents(runnerEvents);
      orchestrator.onCycle(feedEvents, runnerEvents);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'engine gagal memproses candle');
      events.record({ agent: 'system', level: 'error', summary: 'Engine gagal memproses candle — lihat log server', source: 'rules' });
    }
  });
  events.record({
    agent: 'system',
    level: 'info',
    summary: `Desk aktif · feed ${provider.name}${provider.isMock ? ' (MOCK DATA)' : ''} · LLM ${llm ? `${llm.name}/${llm.model}` : 'none (rule-based)'} · ${feed.size().M1} candle M1 dimuat`,
    source: 'rules',
  });

  const metricsTimer = setInterval(() => {
    if (hub.clientCount > 0) hub.broadcast({ type: 'metrics', metrics: metrics() });
    const status = provider.status();
    if (status.replay) hub.broadcast({ type: 'replay', state: status.replay });
  }, METRICS_INTERVAL_MS);

  await app.listen({ port: env.SERVER_PORT, host: env.SERVER_HOST });
  logger.info({ port: env.SERVER_PORT, ws: '/ws' }, 'server listening');

  const shutdown = async () => {
    logger.info('shutting down…');
    clearInterval(metricsTimer);
    await provider.stop();
    await orchestrator.idle();
    await app.close();
    await persistence.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[server] ${message}\n`);
  process.exit(1);
});
