import type { Candle, HistoricalDataProvider } from '@aurum/shared';
import { describe, expect, test, vi } from 'vitest';
import { ingestRange } from '../src/pipeline/ingest-range';
import { checkFreshness, listGaps, runBackfill, runIncremental, runReconcile } from '../src/pipeline/jobs';
import { createMemoryStore } from '../src/pipeline/store';
import { T0, series } from './fixtures';

const DAY = 86_400;

/** Fake provider backed by a full in-memory M1 history; records every requested range. */
function fakeProvider(history: readonly Candle[]): HistoricalDataProvider & { calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = [];
  return {
    name: 'dukascopy',
    unofficial: false,
    calls,
    fetchHistory: async (from, to) => {
      const a = from.getTime() / 1000;
      const b = to.getTime() / 1000;
      calls.push([a, b]);
      return history.filter((c) => c.time >= a && c.time < b);
    },
  };
}

// Two hours of bars on a Tuesday, plus the following Tuesday (to make weekly chunks meaningful)
const week1 = series(120, T0);
const week2 = series(120, T0 + 7 * DAY);
const history = [...week1, ...week2];
const now = T0 + 8 * DAY;

describe('ingestRange', () => {
  test('fetches, validates, stores raw payload, upserts and records a run', async () => {
    const store = createMemoryStore();
    const provider = fakeProvider(history);
    const summary = await ingestRange({ provider, store, kind: 'backfill', fromSec: T0, toSec: T0 + 2 * 3600, nowSec: now });
    expect(summary.rowsWritten).toBe(120);
    expect(store.rows.size).toBe(120);
    expect(store.raw).toHaveLength(1);
    expect(store.runs.get(summary.runId)?.result?.status).toBe('ok');
  });

  test('is idempotent: re-running writes the same rows without duplicates', async () => {
    const store = createMemoryStore();
    const provider = fakeProvider(history);
    await ingestRange({ provider, store, kind: 'backfill', fromSec: T0, toSec: T0 + 7200, nowSec: now });
    await ingestRange({ provider, store, kind: 'backfill', fromSec: T0, toSec: T0 + 7200, nowSec: now });
    expect(store.rows.size).toBe(120);
  });

  test('skips chunks that are already filled when skipIfFilled is set (resumable backfill)', async () => {
    const store = createMemoryStore();
    await store.upsert(week1);
    const provider = fakeProvider(history);
    const summary = await ingestRange({
      provider,
      store,
      kind: 'backfill',
      fromSec: T0,
      toSec: T0 + 7200,
      nowSec: now,
      chunkSeconds: 3600,
      skipIfFilled: true,
    });
    expect(summary.chunks.every((c) => c.skipped)).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  test('marks the run failed and rethrows when the provider throws', async () => {
    const store = createMemoryStore();
    const provider: HistoricalDataProvider = {
      name: 'dukascopy',
      unofficial: false,
      fetchHistory: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await expect(ingestRange({ provider, store, kind: 'incremental', fromSec: T0, toSec: T0 + 60, nowSec: now })).rejects.toThrow('boom');
    expect([...store.runs.values()][0]?.result).toMatchObject({ status: 'failed', error: 'boom' });
  });

  test('rejects an empty range', async () => {
    const store = createMemoryStore();
    await expect(ingestRange({ provider: fakeProvider([]), store, kind: 'backfill', fromSec: T0, toSec: T0, nowSec: now })).rejects.toThrow(RangeError);
  });
});

describe('jobs', () => {
  test('runBackfill chunks weekly, skips the already-filled week and refreshes aggregates', async () => {
    const store = createMemoryStore();
    await store.upsert(week1);
    const provider = fakeProvider(history);
    await runBackfill({ provider, store, fromSec: T0, toSec: T0 + 7 * DAY + 7200, nowSec: now });
    expect(store.rows.size).toBe(240);
    expect(store.refreshes).toHaveLength(1);
  });

  test('runIncremental starts from latest − overlap, or a 1-day lookback when empty', async () => {
    const store = createMemoryStore();
    const provider = fakeProvider(history);
    await runIncremental({ provider, store, nowSec: now });
    expect(provider.calls[0]?.[0]).toBe(now - DAY);
    await store.upsert(week2);
    provider.calls.length = 0;
    await runIncremental({ provider, store, nowSec: now });
    const latest = week2[week2.length - 1]!.time;
    expect(provider.calls[0]?.[0]).toBe(latest - 2 * 3600);
  });

  test('listGaps + runReconcile re-fetch only missing ranges', async () => {
    const store = createMemoryStore();
    // One full day of bars ending at T0 + 2h, with a 20-minute hole; bars in closed hours are harmless extras.
    const dayStart = T0 + 7200 - DAY;
    const dayHistory = series(24 * 60, dayStart);
    const hole = (t: number) => t >= T0 + 40 * 60 && t < T0 + 60 * 60;
    await store.upsert(dayHistory.filter((c) => !hole(c.time)));
    const provider = fakeProvider(dayHistory);
    const gaps = await listGaps(store, T0 + 7200, { lookbackDays: 1 });
    expect(gaps).toEqual([{ fromSec: T0 + 40 * 60, toSec: T0 + 59 * 60, minutes: 20 }]);
    const summary = await runReconcile({ provider, store, nowSec: T0 + 7200, lookbackDays: 1 });
    expect(summary.gapsFound).toBe(1);
    expect(store.rows.size).toBe(dayHistory.length);
    expect(provider.calls).toHaveLength(1);
    expect(store.refreshes).toHaveLength(1);
  });

  test('checkFreshness flags stale data only while the market is open', async () => {
    const store = createMemoryStore();
    await store.upsert(series(5, T0));
    const latest = T0 + 4 * 60;
    expect(await checkFreshness(store, latest + 30 * 60, 60)).toMatchObject({ stale: false, ageMinutes: 30 });
    expect(await checkFreshness(store, latest + 90 * 60, 60)).toMatchObject({ stale: true, ageMinutes: 90 });
    const saturday = Date.UTC(2025, 8, 6, 12) / 1000;
    expect(await checkFreshness(store, saturday, 60)).toMatchObject({ stale: false, marketOpen: false });
    expect(await checkFreshness(createMemoryStore(), T0, 60)).toMatchObject({ stale: true, latest: null });
  });
});
