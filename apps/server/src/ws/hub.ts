import { encodeWsMessage, type WsServerMessage } from '@aurum/shared';
import type { WebSocket } from 'ws';
import type { Logger } from '../logger';

export const HEARTBEAT_INTERVAL_MS = 30_000;

type TrackedSocket = WebSocket & { isAlive?: boolean };

/** Fan-out of typed server messages to every connected browser. */
export class WsHub {
  private readonly sockets = new Set<TrackedSocket>();
  private readonly logger: Logger;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  attach(socket: WebSocket, hello: () => WsServerMessage[]): void {
    const tracked = socket as TrackedSocket;
    tracked.isAlive = true;
    this.sockets.add(tracked);
    tracked.on('pong', () => {
      tracked.isAlive = true;
    });
    tracked.on('close', () => this.sockets.delete(tracked));
    tracked.on('error', (error) => {
      this.logger.warn({ error: error.message }, 'ws client error');
      this.sockets.delete(tracked);
    });
    for (const message of hello()) this.sendTo(tracked, message);
    this.logger.debug({ clients: this.sockets.size }, 'ws client connected');
  }

  broadcast(message: WsServerMessage): void {
    if (this.sockets.size === 0) return;
    const payload = encodeWsMessage(message);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  sendTo(socket: WebSocket, message: WsServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(encodeWsMessage(message));
  }

  get clientCount(): number {
    return this.sockets.size;
  }

  startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const socket of this.sockets) {
        if (socket.isAlive === false) {
          socket.terminate();
          this.sockets.delete(socket);
          continue;
        }
        socket.isAlive = false;
        socket.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const socket of this.sockets) socket.close(1001, 'shutdown');
    this.sockets.clear();
  }
}
