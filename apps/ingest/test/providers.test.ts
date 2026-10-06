import type { Candle } from '@aurum/shared';
import { TwelveDataError } from '@aurum/shared/node';
import { describe, expect, test, vi } from 'vitest';
import { assertTradingViewNotAlone } from '../src/config/env';
import { Mt5CsvProvider, parseMt5Csv } from '../src/providers/mt5csv';
import { TV_MAX_BARS, TradingViewProvider, decodeFrames, encodeFrame, parseSeriesBars, type TvSocket } from '../src/providers/tradingview';
import { TwelveDataHistoryProvider } from '../src/providers/twelvedata';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MT5 CSV import', () => {
  const text = ['<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>', '2026.09.01\t00:01:00\t4620.10\t4620.80\t4619.90\t4620.50\t18\t0\t12', '2026.09.01\t00:00:00\t4619.80\t4620.20\t4619.50\t4620.10\t15\t0\t12'].join('\n');

  test('parses tab-separated bars, converts broker time to UTC, sorts ascending', () => {
    const candles = parseMt5Csv(text, 180); // EEST = UTC+3
    expect(candles.map((c) => c.time)).toEqual([Date.UTC(2026, 7, 31, 21, 0) / 1000, Date.UTC(2026, 7, 31, 21, 1) / 1000]);
    expect(candles[0]).toMatchObject({ open: 4619.8, volume: 15 });
  });

  test('daily exports without <TIME> and invalid rows', () => {
    const daily = '<DATE>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2026.09.01\t1\t2\t0.5\t1.5\t9\t0\t1';
    expect(parseMt5Csv(daily, 0)[0]?.time).toBe(Date.UTC(2026, 8, 1) / 1000);
    expect(() => parseMt5Csv('foo\tbar\n1\t2', 0)).toThrow(/Header MT5/);
    expect(() => parseMt5Csv('<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\nx\t00:00:00\t1\t2\t0\t1', 0)).toThrow(/tanggal/);
  });

  test('provider slices the file by range and reports its span', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt5-'));
    const path = join(dir, 'bars.csv');
    writeFileSync(path, text);
    const p = new Mt5CsvProvider({ path, offsetMinutes: 180 });
    const range = await p.range();
    expect(range).toEqual({ fromSec: Date.UTC(2026, 7, 31, 21, 0) / 1000, toSec: Date.UTC(2026, 7, 31, 21, 2) / 1000 });
    const slice = await p.fetchHistory(new Date(Date.UTC(2026, 7, 31, 21, 1)), new Date(Date.UTC(2026, 7, 31, 22)));
    expect(slice).toHaveLength(1);
    expect(p.unofficial).toBe(false);
  });
});

describe('Twelve Data history provider', () => {
  test('pages 5000-minute windows with pauses and retries once on 429', async () => {
    const calls: Array<{ fromSec?: number; toSec?: number }> = [];
    let rateLimited = true;
    const client = {
      timeSeries: vi.fn(async (args: { fromSec?: number; toSec?: number }) => {
        calls.push(args);
        if (rateLimited) {
          rateLimited = false;
          throw new TwelveDataError(429, 'credits');
        }
        const c: Candle = { time: args.fromSec!, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 };
        return [c];
      }),
    };
    const sleeps: number[] = [];
    const p = new TwelveDataHistoryProvider({ client: client as never, pauseMs: 10, sleep: async (ms) => void sleeps.push(ms), now: () => 2e12 });
    const from = 1_700_000_000;
    const out = await p.fetchHistory(new Date(from * 1000), new Date((from + 7000 * 60) * 1000));
    expect(calls).toHaveLength(3); // window 1 (429 + retry), window 2
    expect(sleeps).toEqual([61_000, 10]);
    expect(out.map((c) => c.time)).toEqual([from, from + 5000 * 60]);
  });
});

describe('TradingView adapter (unofficial, offline protocol tests)', () => {
  test('frame codec round-trips and splits heartbeats from messages', () => {
    const frame = encodeFrame('set_auth_token', ['unauthorized_user_token']);
    expect(frame.startsWith('~m~')).toBe(true);
    const raw = `${frame}~m~4~m~~h~1~m~7~m~garbage`;
    const frames = decodeFrames(raw);
    expect(frames.map((f) => f.kind)).toEqual(['message', 'heartbeat', 'other']);
    expect(frames[0]).toMatchObject({ method: 'set_auth_token' });
  });

  test('parses timescale_update bars and drops malformed entries', () => {
    const params = ['cs_1', { sds_1: { s: [{ i: 0, v: [1_700_000_000, 1, 2, 0.5, 1.5, 10] }, { i: 1, v: [1, 2] }, { i: 2, v: [1_700_000_060, 1, 0.9, 0.5, 1.5] }] } }];
    const bars = parseSeriesBars(params, 'sds_1');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ time: 1_700_000_000, volume: 10 });
    expect(parseSeriesBars(params, 'other')).toEqual([]);
  });

  test('fetchHistory drives the handshake, answers heartbeats, and resolves on series_completed', async () => {
    const sent: string[] = [];
    const listeners: Record<string, Array<(...a: never[]) => void>> = {};
    const socket: TvSocket = {
      on: (event: string, cb: (...a: never[]) => void) => {
        (listeners[event] ??= []).push(cb);
      },
      send: (d: string) => sent.push(d),
      close: () => undefined,
    } as TvSocket;
    const p = new TradingViewProvider({ connect: () => socket, timeoutMs: 1000, symbol: 'OANDA:XAUUSD' });
    const fromSec = Math.floor(Date.now() / 1000 / 60) * 60 - 600;
    const promise = p.fetchHistory(new Date(fromSec * 1000), new Date((fromSec + 300) * 1000));
    for (const cb of listeners.open ?? []) (cb as () => void)();
    expect(sent.some((s) => s.includes('create_series'))).toBe(true);
    const payload = JSON.stringify({ m: 'timescale_update', p: ['cs', { sds_1: { s: [{ i: 0, v: [fromSec, 1, 2, 0.5, 1.5, 3] }, { i: 1, v: [fromSec + 900, 1, 2, 0.5, 1.5, 3] }] } }] });
    const done = JSON.stringify({ m: 'series_completed', p: ['cs'] });
    for (const cb of listeners.message ?? []) (cb as (d: { toString(): string }) => void)({ toString: () => `~m~4~m~~h~7~m~${payload.length}~m~${payload}~m~${done.length}~m~${done}` });
    const bars = await promise;
    expect(bars.map((c) => c.time)).toEqual([fromSec]);
    expect(sent).toContain('~m~4~m~~h~7');
    expect(p.unofficial).toBe(true);
    expect(TV_MAX_BARS).toBe(5000);
  });

  test('protocol errors and timeouts reject instead of hanging', async () => {
    const listeners: Record<string, Array<(...a: never[]) => void>> = {};
    const socket = { on: (e: string, cb: (...a: never[]) => void) => void (listeners[e] ??= []).push(cb), send: () => undefined, close: () => undefined } as unknown as TvSocket;
    const p = new TradingViewProvider({ connect: () => socket, timeoutMs: 30 });
    const promise = p.fetchHistory(new Date(0), new Date(60_000));
    for (const cb of listeners.open ?? []) (cb as () => void)();
    const err = JSON.stringify({ m: 'critical_error', p: ['cs', 'invalid'] });
    for (const cb of listeners.message ?? []) (cb as (d: { toString(): string }) => void)({ toString: () => `~m~${err.length}~m~${err}` });
    await expect(promise).rejects.toThrow(/critical_error/);
    const silent = new TradingViewProvider({ connect: () => socket, timeoutMs: 20 });
    await expect(silent.fetchHistory(new Date(0), new Date(60_000))).rejects.toThrow(/timeout/);
  });

  test('tradingview may never be the only source', () => {
    expect(() => assertTradingViewNotAlone(['tradingview'])).toThrow(/tidak boleh hanya/);
    expect(() => assertTradingViewNotAlone(['dukascopy', 'tradingview'])).not.toThrow();
  });
});
