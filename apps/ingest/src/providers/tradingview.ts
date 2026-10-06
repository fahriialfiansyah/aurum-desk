import { CandleSchema, type Candle, type HistoricalDataProvider } from '@aurum/shared';
import WebSocket from 'ws';

/**
 * UNOFFICIAL adapter over TradingView's undocumented chart websocket (the protocol `tvDatafeed` uses).
 * It violates TradingView's Terms of Service, can break at any time, and is OFF by default
 * (TRADINGVIEW_ENABLED=true). It must never be the only ingest source. Use at your own risk.
 */
export const TV_WS_URL = 'wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart';
export const TV_ORIGIN = 'https://www.tradingview.com';
export const TV_DEFAULT_SYMBOL = 'OANDA:XAUUSD';
export const TV_MAX_BARS = 5000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MINUTE = 60;

export type TvFrame = { kind: 'heartbeat'; raw: string } | { kind: 'message'; method: string; params: unknown[] } | { kind: 'other'; raw: string };

/** `~m~<len>~m~<payload>` framing. */
export function encodeFrame(method: string, params: unknown[]): string {
  const body = JSON.stringify({ m: method, p: params });
  return `~m~${body.length}~m~${body}`;
}

export function decodeFrames(raw: string): TvFrame[] {
  const frames: TvFrame[] = [];
  const re = /~m~(\d+)~m~/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const length = Number(match[1]);
    const start = match.index + match[0].length;
    const payload = raw.slice(start, start + length);
    re.lastIndex = start + length;
    if (/^~h~\d+$/.test(payload)) {
      frames.push({ kind: 'heartbeat', raw: payload });
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as { m?: string; p?: unknown[] };
      if (parsed && typeof parsed.m === 'string') frames.push({ kind: 'message', method: parsed.m, params: parsed.p ?? [] });
      else frames.push({ kind: 'other', raw: payload });
    } catch {
      frames.push({ kind: 'other', raw: payload });
    }
  }
  return frames;
}

/** Extracts M1 bars from a `timescale_update` / `du` message for `seriesId`. */
export function parseSeriesBars(params: unknown[], seriesId: string): Candle[] {
  const container = params[1] as Record<string, { s?: Array<{ v?: number[] }> }> | undefined;
  const series = container?.[seriesId]?.s;
  if (!Array.isArray(series)) return [];
  const out: Candle[] = [];
  for (const item of series) {
    const v = item.v;
    if (!v || v.length < 5) continue;
    const parsed = CandleSchema.safeParse({ time: Math.floor(v[0]!), open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] ?? 0 });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type TvSocket = {
  on(event: 'open' | 'close', cb: () => void): void;
  on(event: 'message', cb: (data: { toString(): string }) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  send(data: string): void;
  close(): void;
};

export type TradingViewOptions = {
  symbol?: string;
  timeoutMs?: number;
  /** Injected for tests. */
  connect?: () => TvSocket;
};

export class TradingViewProvider implements HistoricalDataProvider {
  readonly name = 'tradingview' as const;
  readonly unofficial = true;
  private readonly symbol: string;
  private readonly timeoutMs: number;
  private readonly connect: () => TvSocket;

  constructor(options: TradingViewOptions = {}) {
    this.symbol = options.symbol ?? TV_DEFAULT_SYMBOL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.connect = options.connect ?? (() => new WebSocket(TV_WS_URL, { headers: { Origin: TV_ORIGIN } }) as unknown as TvSocket);
  }

  async fetchHistory(from: Date, to: Date): Promise<Candle[]> {
    const fromSec = Math.floor(from.getTime() / 1000);
    const toSec = Math.floor(to.getTime() / 1000);
    const bars = Math.min(TV_MAX_BARS, Math.ceil((Date.now() / 1000 - fromSec) / MINUTE) + 10);
    const all = await this.requestBars(bars);
    return all.filter((c) => c.time >= fromSec && c.time < toSec);
  }

  private requestBars(bars: number): Promise<Candle[]> {
    const session = `cs_${Math.random().toString(36).slice(2, 14)}`;
    const seriesId = 'sds_1';
    const collected = new Map<number, Candle>();
    return new Promise<Candle[]>((resolve, reject) => {
      let socket: TvSocket;
      try {
        socket = this.connect();
      } catch (error) {
        reject(new Error(`TradingView: koneksi gagal (${error instanceof Error ? error.message : String(error)})`));
        return;
      }
      let settled = false;
      const finish = (error: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        if (error) reject(error);
        else resolve([...collected.values()].sort((a, b) => a.time - b.time));
      };
      const timer = setTimeout(() => finish(new Error(`TradingView: timeout ${this.timeoutMs} ms (protokol tidak resmi mungkin berubah)`)), this.timeoutMs);
      socket.on('error', (err) => finish(new Error(`TradingView: ${err.message}`)));
      socket.on('close', () => finish(collected.size > 0 ? null : new Error('TradingView: koneksi ditutup sebelum data diterima')));
      socket.on('open', () => {
        socket.send(encodeFrame('set_auth_token', ['unauthorized_user_token']));
        socket.send(encodeFrame('chart_create_session', [session, '']));
        socket.send(encodeFrame('switch_timezone', [session, 'Etc/UTC']));
        socket.send(encodeFrame('resolve_symbol', [session, 'sds_sym_1', `={"symbol":"${this.symbol}","adjustment":"splits"}`]));
        socket.send(encodeFrame('create_series', [session, seriesId, 's1', 'sds_sym_1', '1', bars, '']));
      });
      socket.on('message', (data) => {
        for (const frame of decodeFrames(data.toString())) {
          if (frame.kind === 'heartbeat') {
            socket.send(`~m~${frame.raw.length}~m~${frame.raw}`);
            continue;
          }
          if (frame.kind !== 'message') continue;
          if (frame.method === 'timescale_update' || frame.method === 'du') {
            for (const c of parseSeriesBars(frame.params, seriesId)) collected.set(c.time, c);
          } else if (frame.method === 'series_completed') {
            finish(null);
          } else if (frame.method === 'symbol_error' || frame.method === 'critical_error' || frame.method === 'protocol_error') {
            finish(new Error(`TradingView: ${frame.method} ${JSON.stringify(frame.params).slice(0, 200)}`));
          }
        }
      });
    });
  }
}
