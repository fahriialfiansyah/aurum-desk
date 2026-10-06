import { describe, expect, test, vi } from 'vitest';
import { DukascopyProvider, FETCH_ATTEMPTS } from '../src/providers/dukascopy';

describe('DukascopyProvider', () => {
  test('maps library rows to candles (ms → s) and keeps source precision', async () => {
    const fetchRates = vi.fn(async () => [
      { timestamp: 1_756_684_800_000, open: 3447.685, high: 3447.685, low: 3445.815, close: 3446.185, volume: 0.13 },
    ]);
    const provider = new DukascopyProvider({ fetchRates: fetchRates as never });
    const out = await provider.fetchHistory(new Date('2025-09-01T00:00:00Z'), new Date('2025-09-02T00:00:00Z'));
    expect(out).toEqual([{ time: 1_756_684_800, open: 3447.685, high: 3447.685, low: 3445.815, close: 3446.185, volume: 0.13 }]);
    const config = (fetchRates.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(config).toMatchObject({ instrument: 'xauusd', timeframe: 'm1', format: 'json', retryCount: 0, retryOnEmpty: false });
  });

  test('retries transient failures and then succeeds', async () => {
    const fetchRates = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce([{ timestamp: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
    const sleep = vi.fn(async () => undefined);
    const provider = new DukascopyProvider({ fetchRates: fetchRates as never, sleep });
    const out = await provider.fetchHistory(new Date(0), new Date(120_000));
    expect(out).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test('gives up after FETCH_ATTEMPTS with a readable error', async () => {
    const fetchRates = vi.fn().mockRejectedValue(new Error('down'));
    const provider = new DukascopyProvider({ fetchRates: fetchRates as never, sleep: async () => undefined });
    await expect(provider.fetchHistory(new Date(0), new Date(60_000))).rejects.toThrow(`setelah ${FETCH_ATTEMPTS} percobaan: down`);
    expect(fetchRates).toHaveBeenCalledTimes(FETCH_ATTEMPTS);
  });
});
