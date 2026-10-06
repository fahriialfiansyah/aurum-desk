import { positionSize, DEFAULT_PARAMS } from '@aurum/engine';
import {
  ChatRequestSchema,
  PlaybookIdSchema,
  TimeframeSchema,
  hasReplayControls,
  type LiveMarketDataProvider,
  type PlaybookId,
} from '@aurum/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerEnv } from '../config/env';
import type { EngineRunner, RunnerEvent } from '../engine/runner';
import type { MarketFeed } from '../market/feed';
import type { EventLog } from '../state/event-log';
import type { SetupStore } from '../state/setup-store';

export type ChatHandler = (request: { message: string; conversationId?: string }) => Promise<{ messageId: string }>;

export type RoutesDeps = {
  env: ServerEnv;
  feed: MarketFeed;
  runner: EngineRunner;
  setups: SetupStore;
  events: EventLog;
  provider: LiveMarketDataProvider;
  metrics: () => unknown;
  onRunnerEvents: (events: RunnerEvent[]) => void;
  chat: ChatHandler | null;
};

const candlesQuery = z.object({
  tf: TimeframeSchema.default('M5'),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});
const eventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const playbookBody = z.object({ playbook: PlaybookIdSchema });
const speedBody = z.object({ speed: z.coerce.number().positive().max(10_000) });
const sizeQuery = z.object({
  riskPts: z.coerce.number().positive(),
  accountSize: z.coerce.number().positive().optional(),
  riskPercent: z.coerce.number().positive().max(10).optional(),
});

export function registerRoutes(app: FastifyInstance, deps: RoutesDeps): void {
  const { env, feed, runner, setups, events, provider } = deps;

  app.get('/api/health', async () => ({
    ok: true,
    symbol: env.SYMBOL,
    provider: provider.name,
    isMock: provider.isMock,
    candles: feed.size(),
    serverTime: new Date().toISOString(),
  }));

  app.get('/api/config', async () => ({
    symbol: env.SYMBOL,
    provider: provider.name,
    isMock: provider.isMock,
    llmProvider: env.LLM_PROVIDER,
    riskPercent: env.RISK_PERCENT,
    accountSize: env.ACCOUNT_SIZE,
    engineSource: env.ENGINE_CANDLE_SOURCE,
    replay: hasReplayControls(provider),
  }));

  app.get('/api/candles', async (request, reply) => {
    const parsed = candlesQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Query tidak valid', details: parsed.error.issues });
    const { tf, limit } = parsed.data;
    return { tf, candles: feed.candlesWithForming(tf, limit) };
  });

  app.get('/api/analysis', async (request, reply) => {
    const parsed = z.object({ tf: TimeframeSchema.optional() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Query tidak valid', details: parsed.error.issues });
    if (parsed.data.tf) return { snapshots: [runner.analysis(parsed.data.tf)].filter(Boolean) };
    return { snapshots: runner.analyses() };
  });

  app.get('/api/setups', async () => ({ active: setups.active, journal: setups.journal.slice(0, 200) }));

  app.get('/api/setups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const setup = setups.byId(id);
    if (!setup) return reply.code(404).send({ error: `Setup ${id} tidak ditemukan` });
    return { setup };
  });

  app.get('/api/events', async (request, reply) => {
    const parsed = eventsQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Query tidak valid', details: parsed.error.issues });
    return { events: events.recent(parsed.data.limit), agents: events.agentStates() };
  });

  app.get('/api/metrics', async () => deps.metrics());

  app.get('/api/risk/size', async (request, reply) => {
    const parsed = sizeQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Query tidak valid', details: parsed.error.issues });
    const { riskPts } = parsed.data;
    const accountSize = parsed.data.accountSize ?? env.ACCOUNT_SIZE;
    const riskPercent = parsed.data.riskPercent ?? env.RISK_PERCENT;
    return { accountSize, riskPercent, ...positionSize({ accountSize, riskPercent, riskPts }, DEFAULT_PARAMS.risk) };
  });

  app.post('/api/playbook/run', async (request, reply) => {
    const parsed = playbookBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Body tidak valid: playbook harus intraday_m30_m15 | scalp_m15_m5' });
    const id: PlaybookId = parsed.data.playbook;
    const { result, events: runnerEvents } = runner.runNow(id);
    deps.onRunnerEvents(runnerEvents);
    return {
      playbook: id,
      bias: result.bias,
      direction: result.direction,
      best: result.best,
      runnerUps: result.runnerUps,
      candidates: result.candidates.length,
      reasons: result.reasons,
    };
  });

  app.post('/api/replay/:action', async (request, reply) => {
    if (!hasReplayControls(provider)) return reply.code(409).send({ error: 'Provider aktif bukan replay' });
    const { action } = request.params as { action: string };
    switch (action) {
      case 'play':
        provider.play();
        break;
      case 'pause':
        provider.pause();
        break;
      case 'restart':
        await provider.restart();
        break;
      case 'speed': {
        const parsed = speedBody.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'speed harus angka > 0' });
        provider.setSpeed(parsed.data.speed);
        break;
      }
      default:
        return reply.code(404).send({ error: `Aksi replay tidak dikenal: ${action}` });
    }
    return { ok: true, status: provider.status() };
  });

  app.post('/api/chat', async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Pesan tidak valid (1–2000 karakter)', details: parsed.error.issues });
    if (!deps.chat) return reply.code(503).send({ error: 'Copilot belum aktif' });
    const result = await deps.chat(parsed.data);
    return { ok: true, ...result };
  });
}
