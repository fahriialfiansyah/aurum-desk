import { describe, expect, test, vi } from 'vitest';
import { TwelveDataClient, TwelveDataError, parseTwelveDataTime } from '../src/twelvedata';

const ok = (values: object[]) => new Response(JSON.stringify({ meta: { symbol: 'XAU/USD' }, values, status: 'ok' }), { status: 200 });

describe('TwelveDataClient', () => {
  test('parses ascending candles, drops the forming bar, and builds the right query', async () => {
    const fetchMock = vi.fn(async () =>
      ok([
        { datetime: '2026-10-01 00:01:00', open: '3851.1', high: '3852', low: '3850', close: '3851.5' },
        { datetime: '2026-10-01 00:00:00', open: '3850.1', high: '3851', low: '3849.9', close: '3850.5' },
      ]),
    );
    const client = new TwelveDataClient({ apiKey: 'k', fetchImpl: fetchMock as unknown as typeof fetch });
    const nowSec = parseTwelveDataTime('2026-10-01 00:01:30');
    const candles = await client.timeSeries({ fromSec: nowSec - 600, toSec: nowSec, outputsize: 10, nowSec });
    expect(candles.map((c) => c.time)).toEqual([parseTwelveDataTime('2026-10-01 00:00:00')]);
    expect(candles[0]).toMatchObject({ open: 3850.1, volume: 0 });
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get('symbol')).toBe('XAU/USD');
    expect(url.searchParams.get('interval')).toBe('1min');
    expect(url.searchParams.get('timezone')).toBe('UTC');
    expect(url.searchParams.get('order')).toBe('ASC');
    expect(url.searchParams.get('start_date')).toBe('2026-09-30 23:51:30');
    const withForming = await new TwelveDataClient({ apiKey: 'k', fetchImpl: fetchMock as unknown as typeof fetch }).timeSeries({ includeForming: true, nowSec });
    expect(withForming).toHaveLength(2);
  });

  test('surfaces API errors from the body even with HTTP 200, and HTTP 429 as rate limit', async () => {
    const bodyErr = vi.fn(async () => new Response(JSON.stringify({ code: 401, message: 'bad key', status: 'error' }), { status: 200 }));
    await expect(new TwelveDataClient({ apiKey: 'k', fetchImpl: bodyErr as unknown as typeof fetch }).timeSeries()).rejects.toThrow(/401/);
    const http429 = vi.fn(async () => new Response(JSON.stringify({ code: 429, message: 'out of credits', status: 'error' }), { status: 429 }));
    try {
      await new TwelveDataClient({ apiKey: 'k', fetchImpl: http429 as unknown as typeof fetch }).timeSeries();
    } catch (error) {
      expect(error).toBeInstanceOf(TwelveDataError);
      expect((error as TwelveDataError).isRateLimit).toBe(true);
    }
  });

  test('price endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: '3850.12345' }), { status: 200 }));
    expect(await new TwelveDataClient({ apiKey: 'k', fetchImpl: fetchMock as unknown as typeof fetch }).price()).toBeCloseTo(3850.12345);
  });
});
