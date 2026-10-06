import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '@aurum/shared';
import type { ServerEnv } from '../config/env';
import type { Logger } from '../logger';
import { WsHub } from '../ws/hub';
import { registerRoutes, type RoutesDeps } from './routes';

export type AppDeps = RoutesDeps & { logger: Logger; hello: () => WsServerMessage[] };

const RATE_WINDOW_MS = 60_000;

/** Fixed-window counter per client IP for mutating requests. */
export function createRateLimiter(limitPerMinute: number, now: () => number = Date.now) {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return (key: string): boolean => {
    const t = now();
    const bucket = buckets.get(key);
    if (!bucket || t - bucket.windowStart >= RATE_WINDOW_MS) {
      buckets.set(key, { windowStart: t, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limitPerMinute;
  };
}

function bearerFrom(header: string | undefined, query: unknown): string | null {
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const token = (query as { token?: unknown } | undefined)?.token;
  return typeof token === 'string' ? token : null;
}

/** Builds the Fastify app with CORS, the WebSocket endpoint and the REST routes. */
export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; hub: WsHub }> {
  const env: ServerEnv = deps.env;
  // Request logging goes through our own pino instance; Fastify's per-request logger stays off.
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const hub = new WsHub(deps.logger);

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? [env.WEB_ORIGIN] : true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
    preClose: (done) => {
      hub.stop();
      app.websocketServer.close(done);
    },
  });

  const allow = createRateLimiter(env.API_RATE_LIMIT_PER_MINUTE);
  app.addHook('onRequest', async (request, reply) => {
    const isWs = request.url.startsWith('/ws');
    const isMutation = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
    if (env.SERVER_API_TOKEN && (isMutation || isWs)) {
      const token = bearerFrom(request.headers.authorization, request.query);
      if (token !== env.SERVER_API_TOKEN) return reply.code(401).send({ error: 'Token API tidak valid' });
    }
    if (isMutation && !allow(request.ip)) return reply.code(429).send({ error: 'Terlalu banyak permintaan, coba lagi sebentar' });
    return undefined;
  });

  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    hub.attach(socket, deps.hello);
    socket.on('message', (raw) => {
      // Client → server traffic is limited to pings; commands use REST.
      const text = raw.toString();
      if (text.includes('"ping"')) hub.sendTo(socket, { type: 'metrics', metrics: deps.metrics() as never });
    });
  });

  registerRoutes(app, deps);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    deps.logger.error({ err: error.message, url: request.url }, 'request failed');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    void reply.status(status).send({ error: status === 500 ? 'Terjadi kesalahan di server' : error.message });
  });

  hub.startHeartbeat();
  return { app, hub };
}
