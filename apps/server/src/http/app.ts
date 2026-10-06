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
