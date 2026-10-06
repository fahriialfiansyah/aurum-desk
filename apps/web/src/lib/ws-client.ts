'use client';

import { decodeWsServerMessage } from '@aurum/shared';
import { WS_URL } from './config';
import { useDeskStore } from '@/store/desk-store';

const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 10_000;
const PING_INTERVAL_MS = 25_000;

export type WsHandle = { close: () => void };

/** Connects to the server stream, decodes every message with zod, and feeds the store. Reconnects with backoff. */
export function connectDesk(url: string = WS_URL): WsHandle {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const store = useDeskStore.getState;

  const open = () => {
    store().setConnection('connecting');
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
      store().setConnection('open');
      pingTimer = setInterval(() => socket?.send(JSON.stringify({ type: 'ping', ts: Date.now() })), PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      try {
        store().handleMessage(decodeWsServerMessage(String(event.data)));
      } catch (error) {
        // A malformed message is a server bug, not a reason to drop the connection.
        console.warn('[ws] pesan tidak valid diabaikan', error instanceof Error ? error.message : error);
      }
    };
    socket.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      store().setConnection('closed');
      if (closedByUser) return;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(open, delay);
    };
    socket.onerror = () => socket?.close();
  };
  open();

  return {
    close: () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      socket?.close();
    },
  };
}
