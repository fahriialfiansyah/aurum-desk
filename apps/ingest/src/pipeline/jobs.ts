import type { HistoricalDataProvider } from '@aurum/shared';
import { isMarketOpen } from '@aurum/shared';
import type { Logger } from '../logger';
import { findGaps, type GapRange } from './gaps';
import { ingestRange, type ChunkSummary, type RunSummary } from './ingest-range';
import type { IngestStore } from './store';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 7 * DAY;

export const INCREMENTAL_OVERLAP_SECONDS = 2 * HOUR;
export const INCREMENTAL_FALLBACK_LOOKBACK_SECONDS = 1 * DAY;
export const GAP_PADDING_SECONDS = 1 * MINUTE;

type JobDeps = {
  provider: HistoricalDataProvider;
  store: IngestStore;
  nowSec: number;
  logger?: Logger;
  onChunk?: (chunk: ChunkSummary) => void;
};

/** Historical backfill, resumable: already-filled weekly chunks are skipped. */
export async function runBackfill(deps: JobDeps & { fromSec: number; toSec?: number }): Promise<RunSummary> {
  const toSec = deps.toSec ?? deps.nowSec;
  const summary = await ingestRange({ ...deps, kind: 'backfill', fromSec: deps.fromSec, toSec, skipIfFilled: true });
  await deps.store.refreshAggregates({ fromSec: deps.fromSec, toSec });
  return summary;
}

/** Fetches from (latest − overlap) to now; the overlap re-confirms the last bars with upserts. */
export async function runIncremental(deps: JobDeps): Promise<RunSummary> {
  const latest = await deps.store.latestTime();
  const fromSec = latest === null ? deps.nowSec - INCREMENTAL_FALLBACK_LOOKBACK_SECONDS : latest - INCREMENTAL_OVERLAP_SECONDS;
  const summary = await ingestRange({ ...deps, kind: 'incremental', fromSec, toSec: deps.nowSec, chunkSeconds: DAY });
  await deps.store.refreshAggregates({ fromSec, toSec: deps.nowSec });
  return summary;
}

/** Lists gaps in the last `lookbackDays`, scanning one week at a time to bound memory. */
export async function listGaps(
  store: IngestStore,
  nowSec: number,
  options: { lookbackDays: number; minGapMinutes?: number },
): Promise<GapRange[]> {
  const fromSec = nowSec - options.lookbackDays * DAY;
  const gaps: GapRange[] = [];
  for (let a = fromSec; a < nowSec; a += WEEK) {
    const b = Math.min(a + WEEK, nowSec);
    const present = new Set(await store.presentTimes(a, b));
    gaps.push(...findGaps(a, b, present, { minGapMinutes: options.minGapMinutes }));
  }
  return gaps;
}

export type ReconcileSummary = { gapsFound: number; gapsFetched: number; rowsWritten: number };

/** Daily job: detect gaps and re-fetch only those ranges, then refresh the aggregates for the window. */
export async function runReconcile(
  deps: JobDeps & { lookbackDays: number; minGapMinutes?: number },
): Promise<ReconcileSummary> {
  const gaps = await listGaps(deps.store, deps.nowSec, deps);
  let rowsWritten = 0;
  for (const gap of gaps) {
    const summary = await ingestRange({
      ...deps,
      kind: 'gaps',
      fromSec: gap.fromSec - GAP_PADDING_SECONDS,
      toSec: gap.toSec + MINUTE + GAP_PADDING_SECONDS,
      chunkSeconds: DAY,
    });
    rowsWritten += summary.rowsWritten;
    deps.logger?.info({ gap, written: summary.rowsWritten }, 'gap diproses');
  }
  if (gaps.length > 0) {
    await deps.store.refreshAggregates({ fromSec: deps.nowSec - deps.lookbackDays * DAY, toSec: deps.nowSec });
  }
  return { gapsFound: gaps.length, gapsFetched: gaps.length, rowsWritten };
}

export type FreshnessReport = { stale: boolean; latest: number | null; ageMinutes: number | null; marketOpen: boolean };

/** Newest candle older than `maxAgeMinutes` during market hours → stale. */
export async function checkFreshness(store: IngestStore, nowSec: number, maxAgeMinutes: number): Promise<FreshnessReport> {
  const latest = await store.latestTime();
  const marketOpen = isMarketOpen(nowSec);
  const ageMinutes = latest === null ? null : Math.floor((nowSec - latest) / MINUTE);
  const stale = marketOpen && (ageMinutes === null || ageMinutes > maxAgeMinutes);
  return { stale, latest, ageMinutes, marketOpen };
}
