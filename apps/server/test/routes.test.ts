import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { serverEnvSchema } from '../src/config/env';
import { EngineRunner } from '../src/engine/runner';
import { buildApp } from '../src/http/app';
import { MarketFeed } from '../src/market/feed';
import { ReplayProvider } from '../src/providers/replay';
import { EventLog } from '../src/state/event-log';
import { SetupStore } from '../src/state/setup-store';
import { realSample } from './helpers';

let app: FastifyInstance;
let provider: ReplayProvider;

beforeAll(async () => {
  const env = serverEnvSchema.parse({ DATABASE_URL: 'postgres://x:y@localhost:5432/z', NODE_ENV: 'test' });
  const m1 = realSample().slice(0, 5000);
  provider = new ReplayProvider({ candles: m1, speed: 600, warmupBars: 4000, source: 'csv:test' });
  const feed = new MarketFeed();
  feed.loadHistory(await provider.warmup(4000));
  const setups = new SetupStore();
  const events = new EventLog();
  const runner = new EngineRunner({ feed, setups, events });
  const built = await buildApp({
    env,
    logger: pino({ level: 'silent' }),
    feed,
    runner,
    setups,
    events,
    provider,
    metrics: () => ({ ok: true }),
    hello: () => [],
    onRunnerEvents: () => undefined,
    chat: null,
  });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('REST API', () => {
  test('health and config', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, provider: 'replay', isMock: false });
    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.json()).toMatchObject({ symbol: 'XAUUSD', replay: true, llmProvider: 'none' });
  });

  test('candles with validation', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/candles?tf=M15&limit=10' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().candles).toHaveLength(10);
    const bad = await app.inject({ method: 'GET', url: '/api/candles?tf=H1' });
    expect(bad.statusCode).toBe(400);
  });

  test('playbook run returns a deterministic result and 400 on bad body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/playbook/run', payload: { playbook: 'scalp_m15_m5' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().playbook).toBe('scalp_m15_m5');
    expect(res.json().bias.tf).toBe('M15');
    const bad = await app.inject({ method: 'POST', url: '/api/playbook/run', payload: { playbook: 'nope' } });
    expect(bad.statusCode).toBe(400);
    const setups = await app.inject({ method: 'GET', url: '/api/setups' });
    expect(Array.isArray(setups.json().active)).toBe(true);
    const missing = await app.inject({ method: 'GET', url: '/api/setups/does-not-exist' });
    expect(missing.statusCode).toBe(404);
  });

  test('replay controls', async () => {
    const pause = await app.inject({ method: 'POST', url: '/api/replay/pause' });
    expect(pause.json().status.replay.playing).toBe(false);
    const speed = await app.inject({ method: 'POST', url: '/api/replay/speed', payload: { speed: 5 } });
    expect(speed.json().status.replay.speed).toBe(5);
    const bad = await app.inject({ method: 'POST', url: '/api/replay/speed', payload: { speed: -1 } });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({ method: 'POST', url: '/api/replay/fly' });
    expect(unknown.statusCode).toBe(404);
  });

  test('position size helper and chat 503 when the copilot is not wired', async () => {
    const size = await app.inject({ method: 'GET', url: '/api/risk/size?riskPts=4.2' });
    expect(size.json()).toMatchObject({ accountSize: 10000, riskPercent: 1, lots: 0.23 });
    const chat = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'halo' } });
    expect(chat.statusCode).toBe(503);
    const badChat = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: '' } });
    expect(badChat.statusCode).toBe(400);
  });

  test('events endpoint lists agent states', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events?limit=5' });
    expect(res.json().agents).toHaveLength(6);
  });
});
