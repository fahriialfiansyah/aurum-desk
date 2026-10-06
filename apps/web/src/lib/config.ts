/** Public runtime config (inlined at build time by Next). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';
export const CHART_HISTORY_LIMIT = 1500;
export const THEME_STORAGE_KEY = 'aurum-theme';
/** Optional shared secret matching SERVER_API_TOKEN on the server (sent on POST + WebSocket). */
export const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN ?? '';
