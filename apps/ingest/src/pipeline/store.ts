import {
  countM1Between,
  finishIngestRun,
  getLatestM1Time,
  getM1Times,
  recordAnomalies,
  refreshAggregates,
  startIngestRun,
  storeRawIngest,
  upsertM1Candles,
  type DbHandle,
  type IngestRunKind,
} from '@aurum/db';
import type { Candle } from '@aurum/shared';
import type { AnomalyRecord } from './validate';

export type RunResult = { status: 'ok' | 'failed'; rowsWritten: number; error?: string; meta?: unknown };

/** Everything the pipeline needs from persistence, so it can run against memory in tests. */
export interface IngestStore {
  readonly symbol: string;
  readonly source: string;
  countBetween(fromSec: number, toSec: number): Promise<number>;
  presentTimes(fromSec: number, toSec: number): Promise<number[]>;
  latestTime(): Promise<number | null>;
  upsert(candles: readonly Candle[]): Promise<number>;
  storeRaw(args: { rangeFrom: Date; rangeTo: Date; rowCount: number; payload: unknown }): Promise<void>;
  recordAnomalies(items: readonly AnomalyRecord[]): Promise<void>;
  startRun(kind: IngestRunKind, meta?: unknown): Promise<number>;
  finishRun(id: number, result: RunResult): Promise<void>;
  refreshAggregates(window?: { fromSec: number; toSec: number }): Promise<void>;
}

export function createDbStore(handle: DbHandle, symbol: string, source: string): IngestStore {
  const { db, pool } = handle;
  return {
    symbol,
    source,
    countBetween: (fromSec, toSec) => countM1Between(db, { symbol, source, fromSec, toSec }),
    presentTimes: (fromSec, toSec) => getM1Times(db, { symbol, source, fromSec, toSec }),
    latestTime: () => getLatestM1Time(db, symbol, source),
    upsert: (candles) => upsertM1Candles(db, candles.map((candle) => ({ symbol, source, candle }))),
    storeRaw: (args) => storeRawIngest(db, { source, ...args }),
    recordAnomalies: (items) =>
      recordAnomalies(
        db,
        items.map((a) => ({ symbol, source, tsSec: a.tsSec, kind: a.kind, detail: a.detail })),
      ),
    startRun: (kind, meta) => startIngestRun(db, source, kind, meta),
    finishRun: (id, result) => finishIngestRun(db, id, result),
    refreshAggregates: (window) => refreshAggregates(pool, window ?? null),
  };
}

export type MemoryStore = IngestStore & {
  rows: Map<number, Candle>;
  raw: unknown[];
  anomalies: AnomalyRecord[];
  runs: Map<number, { kind: IngestRunKind; meta?: unknown; result?: RunResult }>;
  refreshes: Array<{ fromSec: number; toSec: number } | undefined>;
};

/** In-memory store for unit tests and dry runs. */
export function createMemoryStore(symbol = 'XAUUSD', source = 'test'): MemoryStore {
  const rows = new Map<number, Candle>();
  const raw: unknown[] = [];
  const anomalies: AnomalyRecord[] = [];
  const runs = new Map<number, { kind: IngestRunKind; meta?: unknown; result?: RunResult }>();
  const refreshes: Array<{ fromSec: number; toSec: number } | undefined> = [];
  let nextRun = 1;
  const times = () => [...rows.keys()].sort((a, b) => a - b);
  return {
    symbol,
    source,
    rows,
    raw,
    anomalies,
    runs,
    refreshes,
    countBetween: async (fromSec, toSec) => times().filter((t) => t >= fromSec && t < toSec).length,
    presentTimes: async (fromSec, toSec) => times().filter((t) => t >= fromSec && t <= toSec),
    latestTime: async () => (rows.size === 0 ? null : Math.max(...rows.keys())),
    upsert: async (candles) => {
      for (const c of candles) rows.set(c.time, c);
      return candles.length;
    },
    storeRaw: async (args) => {
      raw.push(args);
    },
    recordAnomalies: async (items) => {
      anomalies.push(...items);
    },
    startRun: async (kind, meta) => {
      const id = nextRun;
      nextRun += 1;
      runs.set(id, { kind, meta });
      return id;
    },
    finishRun: async (id, result) => {
      const run = runs.get(id);
      if (run) runs.set(id, { ...run, result });
    },
    refreshAggregates: async (window) => {
      refreshes.push(window);
    },
  };
}
