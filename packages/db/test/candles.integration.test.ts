import type { Candle } from '@aurum/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { DbHandle } from '../src/client';
import { countM1, deleteM1Candles, getCandles, getLatestM1Time, getM1Times, upsertM1Candles } from '../src/repositories/candles';
import { refreshAggregates } from '../src/timescale/apply';
import { connectForTests } from './helpers';

const SYMBOL = 'TESTXAU';
const SOURCE = 'test';
const START = Date.UTC(2025, 8, 1, 10, 0) / 1000; // Monday 10:00 UTC

/** 60 synthetic M1 bars (test fixture only) from 10:00 to 10:59 with price = 3000 + minute. */
function fixtureHour(): Candle[] {
  return Array.from({ length: 60 }, (_, i) => {
    const base = 3000 + i;
    return { time: START + i * 60, open: base, high: base + 0.5, low: base - 0.5, close: base + 0.25, volume: 1 };
  });
}

let handle: DbHandle | null = null;

beforeAll(async () => {
  handle = await connectForTests();
  if (!handle) return;
  await deleteM1Candles(handle.db, SYMBOL, SOURCE);
});

afterAll(async () => {
  if (!handle) return;
  await deleteM1Candles(handle.db, SYMBOL, SOURCE);
  await handle.close();
});

describe('candles repository (requires Postgres/Timescale)', () => {
  test('upsert is idempotent', async (ctx) => {
    if (!handle) return ctx.skip();
    const rows = fixtureHour().map((candle) => ({ symbol: SYMBOL, source: SOURCE, candle }));
    await upsertM1Candles(handle.db, rows);
    await upsertM1Candles(handle.db, rows);
    expect(await countM1(handle.db, SYMBOL, SOURCE)).toBe(60);
    expect(await getLatestM1Time(handle.db, SYMBOL, SOURCE)).toBe(START + 59 * 60);
  });

  test('re-upsert updates prices in place', async (ctx) => {
    if (!handle) return ctx.skip();
    const [first] = fixtureHour();
    if (!first) throw new Error('fixture empty');
    await upsertM1Candles(handle.db, [{ symbol: SYMBOL, source: SOURCE, candle: { ...first, close: first.close + 1, high: first.high + 1 } }]);
    const [m1] = await getCandles(handle.db, { symbol: SYMBOL, source: SOURCE, tf: 'M1', toSec: first.time, limit: 1 });
    expect(m1?.close).toBe(first.close + 1);
    // restore
    await upsertM1Candles(handle.db, [{ symbol: SYMBOL, source: SOURCE, candle: first }]);
  });

  test('continuous aggregates derive M5/M15/M30 on exact boundaries', async (ctx) => {
    if (!handle) return ctx.skip();
    await refreshAggregates(handle.pool, { fromSec: START - 3600, toSec: START + 2 * 3600 });

    const m5 = await getCandles(handle.db, { symbol: SYMBOL, source: SOURCE, tf: 'M5', limit: 100 });
    expect(m5).toHaveLength(12);
    expect(m5[0]?.time).toBe(START);
    expect(m5[0]?.open).toBe(3000); // first(open)
    expect(m5[0]?.close).toBe(3004.25); // last(close) of minute 4
    expect(m5[0]?.high).toBe(3004.5);
    expect(m5[0]?.low).toBe(2999.5);
    expect(m5[0]?.volume).toBe(5);

    const m15 = await getCandles(handle.db, { symbol: SYMBOL, source: SOURCE, tf: 'M15', limit: 100 });
    expect(m15.map((c) => c.time)).toEqual([START, START + 900, START + 1800, START + 2700]);
    expect(m15[3]?.close).toBe(3059.25);

    const m30 = await getCandles(handle.db, { symbol: SYMBOL, source: SOURCE, tf: 'M30', limit: 100 });
    expect(m30.map((c) => c.time)).toEqual([START, START + 1800]);
    expect(m30[1]?.open).toBe(3030);
    expect(m30[1]?.high).toBe(3059.5);
  });

  test('getM1Times returns ascending open times for gap detection', async (ctx) => {
    if (!handle) return ctx.skip();
    const times = await getM1Times(handle.db, { symbol: SYMBOL, source: SOURCE, fromSec: START, toSec: START + 600 });
    expect(times).toEqual(Array.from({ length: 11 }, (_, i) => START + i * 60));
  });
});
