import pino from 'pino';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { serverEnvSchema } from '../src/config/env';
import { EngineRunner } from '../src/engine/runner';
import { buildApp, createRateLimiter } from '../src/http/app';
import { MarketFeed } from '../src/market/feed';
import { ReplayProvider } from '../src/providers/replay';
import { EventLog } from '../src/state/event-log';
import { SetupStore } from '../src/state/setup-store';
import { realSample } from './helpers';

let app: FastifyInstance;

beforeAll(async () => {
  const env = serverEnvSchema.parse({ DATABASE_URL: 'postgres://x:y@localhost:5432/z', SERVER_API_TOKEN: 'secret', API_RATE_LIMIT_PER_MINUTE: '3' });
  const m1 = realSample().slice(0, 4500);
  const provider = new ReplayProvider({ candles: m1, speed: 600, warmupBars: 4000, source: 'csv:test' });
  const feed = new MarketFeed();
  feed.loadHistory(await provider.warmup(4000));
  const setups = new SetupStore();
  const events = new EventLog();
  const runner = new EngineRunner({ feed, setups, events });
  const built = await buildApp({ env, logger: pino({ level: 'silent' }), feed, runner, setups, events, provider, metrics: () => ({}), hello: () => [], onRunnerEvents: () => undefined, chat: null });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('API token + rate limit', () => {
  test('GET stays open; POST needs the bearer token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/replay/pause' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/replay/pause', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/replay/pause', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(200);
  });

  test('mutations are rate limited per client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await app.inject({ method: 'POST', url: '/api/replay/pause', headers: { authorization: 'Bearer secret' }, remoteAddress: '10.0.0.9' })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  test('createRateLimiter resets per window', () => {
    let now = 0;
    const allow = createRateLimiter(2, () => now);
    expect([allow('a'), allow('a'), allow('a')]).toEqual([true, true, false]);
    now += 60_001;
    expect(allow('a')).toBe(true);
  });
});
