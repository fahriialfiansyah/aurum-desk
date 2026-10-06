import { CandleSchema, type Candle, type Timeframe } from '@aurum/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { candlesM1 } from '../schema';
import { DERIVED_CANDLE_VIEWS } from '../timescale/statements';

export const UPSERT_BATCH_SIZE = 1000;

export type CandleRow = { symbol: string; source: string; candle: Candle };

type RawCandleRow = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function toCandle(row: RawCandleRow): Candle {
  return CandleSchema.parse({
    time: Number(row.time),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? 0,
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Idempotent write: `INSERT … ON CONFLICT (symbol, ts, source) DO UPDATE`. Returns the number of rows sent. */
export async function upsertM1Candles(db: Db, rows: readonly CandleRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
    await db
      .insert(candlesM1)
      .values(
        batch.map((r) => ({
          symbol: r.symbol,
          source: r.source,
          ts: new Date(r.candle.time * 1000),
          open: r.candle.open,
          high: r.candle.high,
          low: r.candle.low,
          close: r.candle.close,
          volume: r.candle.volume,
        })),
      )
      .onConflictDoUpdate({
        target: [candlesM1.symbol, candlesM1.ts, candlesM1.source],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          volume: sql`excluded.volume`,
        },
      });
  }
  return rows.length;
}

export type CandleQuery = {
  symbol: string;
  source: string;
  tf: Timeframe;
  /** Inclusive upper bound on bar open time (unix seconds). */
  toSec?: number;
  /** Inclusive lower bound on bar open time (unix seconds). */
  fromSec?: number;
  limit: number;
  /** 'desc' (default) returns the latest `limit` bars; 'asc' returns the earliest `limit` bars from `fromSec`. */
  order?: 'asc' | 'desc';
};

const MAX_CANDLE_LIMIT = 50_000;

function relationFor(tf: Timeframe) {
  return tf === 'M1' ? sql.raw('candles_m1') : sql.raw(DERIVED_CANDLE_VIEWS[tf]);
}

/** `limit` candles within the window, always returned in ascending time order. Higher TFs come from continuous aggregates. */
export async function getCandles(db: Db, query: CandleQuery): Promise<Candle[]> {
  const limit = Math.min(Math.max(1, Math.floor(query.limit)), MAX_CANDLE_LIMIT);
  const ascending = query.order === 'asc';
  const conditions = [sql`symbol = ${query.symbol}`, sql`source = ${query.source}`];
  if (query.toSec !== undefined) conditions.push(sql`ts <= to_timestamp(${query.toSec})`);
  if (query.fromSec !== undefined) conditions.push(sql`ts >= to_timestamp(${query.fromSec})`);
  const where = sql.join(conditions, sql` AND `);
  const result = await db.execute<RawCandleRow>(sql`
    SELECT extract(epoch FROM ts)::bigint AS time, open, high, low, close, volume
    FROM ${relationFor(query.tf)}
    WHERE ${where}
    ORDER BY ts ${ascending ? sql.raw('ASC') : sql.raw('DESC')}
    LIMIT ${limit}
  `);
  const candles = result.rows.map(toCandle);
  return ascending ? candles : candles.reverse();
}

export async function getLatestM1Time(db: Db, symbol: string, source: string): Promise<number | null> {
  const [row] = await db
    .select({ ts: sql<string | null>`extract(epoch FROM max(${candlesM1.ts}))::bigint` })
    .from(candlesM1)
    .where(and(eq(candlesM1.symbol, symbol), eq(candlesM1.source, source)));
  return row?.ts === null || row?.ts === undefined ? null : Number(row.ts);
}

export async function getEarliestM1Time(db: Db, symbol: string, source: string): Promise<number | null> {
  const [row] = await db
    .select({ ts: sql<string | null>`extract(epoch FROM min(${candlesM1.ts}))::bigint` })
    .from(candlesM1)
    .where(and(eq(candlesM1.symbol, symbol), eq(candlesM1.source, source)));
  return row?.ts === null || row?.ts === undefined ? null : Number(row.ts);
}

export async function countM1(db: Db, symbol: string, source: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(candlesM1)
    .where(and(eq(candlesM1.symbol, symbol), eq(candlesM1.source, source)));
  return Number(row?.n ?? 0);
}

/** Number of M1 bars with open time in [fromSec, toSec). */
export async function countM1Between(
  db: Db,
  args: { symbol: string; source: string; fromSec: number; toSec: number },
): Promise<number> {
  const result = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM candles_m1
    WHERE symbol = ${args.symbol} AND source = ${args.source}
      AND ts >= to_timestamp(${args.fromSec}) AND ts < to_timestamp(${args.toSec})
  `);
  return Number(result.rows[0]?.n ?? 0);
}

/** All M1 open times (unix seconds, ascending) within [fromSec, toSec]. Callers should chunk large ranges. */
export async function getM1Times(
  db: Db,
  args: { symbol: string; source: string; fromSec: number; toSec: number },
): Promise<number[]> {
  const result = await db.execute<{ time: string }>(sql`
    SELECT extract(epoch FROM ts)::bigint AS time
    FROM candles_m1
    WHERE symbol = ${args.symbol} AND source = ${args.source}
      AND ts >= to_timestamp(${args.fromSec}) AND ts <= to_timestamp(${args.toSec})
    ORDER BY ts ASC
  `);
  return result.rows.map((r) => Number(r.time));
}

/** Test helper / maintenance: remove all candles of a symbol+source. */
export async function deleteM1Candles(db: Db, symbol: string, source: string): Promise<void> {
  await db.delete(candlesM1).where(and(eq(candlesM1.symbol, symbol), eq(candlesM1.source, source)));
}
