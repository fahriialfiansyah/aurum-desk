import type { IngestRunKind } from '@aurum/db';
import type { Candle, HistoricalDataProvider } from '@aurum/shared';
import type { Logger } from '../logger';
import { expectedMinuteCount } from './gaps';
import type { IngestStore } from './store';
import { JUMP_CONTEXT_BARS, validateCandles } from './validate';

const DAY_SECONDS = 86_400;
export const DEFAULT_CHUNK_SECONDS = 7 * DAY_SECONDS;
/** A chunk is skipped when it already holds at least this share of the expected market-hours minutes. */
export const SKIP_FILL_RATIO = 0.97;

export type ChunkSummary = {
  fromSec: number;
  toSec: number;
  skipped: boolean;
  fetched: number;
  written: number;
  rejected: number;
  anomalies: number;
};

export type RunSummary = {
  runId: number;
  kind: IngestRunKind;
  chunks: ChunkSummary[];
  rowsWritten: number;
  rejected: number;
  anomalies: number;
};

export type IngestRangeArgs = {
  provider: HistoricalDataProvider;
  store: IngestStore;
  kind: IngestRunKind;
  /** Inclusive start (unix seconds). */
  fromSec: number;
  /** Exclusive end (unix seconds). */
  toSec: number;
  nowSec: number;
  chunkSeconds?: number;
  /** When true, chunks that are already (almost) full are not re-fetched — makes backfills resumable. */
  skipIfFilled?: boolean;
  logger?: Logger;
  onChunk?: (chunk: ChunkSummary) => void;
};

function* chunks(fromSec: number, toSec: number, size: number): Generator<[number, number]> {
  for (let a = fromSec; a < toSec; a += size) yield [a, Math.min(a + size, toSec)];
}

async function shouldSkip(store: IngestStore, fromSec: number, toSec: number): Promise<boolean> {
  const expected = expectedMinuteCount(fromSec, toSec);
  if (expected === 0) return true; // weekend / break only
  const existing = await store.countBetween(fromSec, toSec);
  return existing >= expected * SKIP_FILL_RATIO;
}

/**
 * Fetch → validate → store, one chunk at a time, with run bookkeeping. Idempotent: writes are upserts.
 * Throws after marking the run as failed so callers (cron, CLI) can alert.
 */
export async function ingestRange(args: IngestRangeArgs): Promise<RunSummary> {
  const { provider, store, kind, fromSec, toSec, nowSec, logger } = args;
  const chunkSeconds = args.chunkSeconds ?? DEFAULT_CHUNK_SECONDS;
  if (toSec <= fromSec) throw new RangeError(`ingestRange: toSec (${toSec}) must be > fromSec (${fromSec})`);

  const runId = await store.startRun(kind, { fromSec, toSec, provider: provider.name });
  const summary: RunSummary = { runId, kind, chunks: [], rowsWritten: 0, rejected: 0, anomalies: 0 };
  let previous: Candle[] = [];

  try {
    for (const [a, b] of chunks(fromSec, toSec, chunkSeconds)) {
      if (args.skipIfFilled && (await shouldSkip(store, a, b))) {
        const skipped: ChunkSummary = { fromSec: a, toSec: b, skipped: true, fetched: 0, written: 0, rejected: 0, anomalies: 0 };
        summary.chunks.push(skipped);
        args.onChunk?.(skipped);
        continue;
      }
      const raw = await provider.fetchHistory(new Date(a * 1000), new Date(b * 1000));
      const result = validateCandles(raw, { nowSec, previous });
      if (raw.length > 0) {
        await store.storeRaw({ rangeFrom: new Date(a * 1000), rangeTo: new Date(b * 1000), rowCount: raw.length, payload: raw });
      }
      const written = await store.upsert(result.candles);
      await store.recordAnomalies(result.anomalies);
      previous = result.candles.slice(-JUMP_CONTEXT_BARS);

      const chunk: ChunkSummary = {
        fromSec: a,
        toSec: b,
        skipped: false,
        fetched: raw.length,
        written,
        rejected: result.rejected.length,
        anomalies: result.anomalies.length,
      };
      summary.chunks.push(chunk);
      summary.rowsWritten += written;
      summary.rejected += chunk.rejected;
      summary.anomalies += chunk.anomalies;
      args.onChunk?.(chunk);
      if (result.rejected.length > 0) {
        logger?.warn({ sample: result.rejected.slice(0, 3) }, `${result.rejected.length} bar ditolak validasi`);
      }
    }
    await store.finishRun(runId, {
      status: 'ok',
      rowsWritten: summary.rowsWritten,
      meta: { chunks: summary.chunks.length, rejected: summary.rejected, anomalies: summary.anomalies },
    });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun(runId, { status: 'failed', rowsWritten: summary.rowsWritten, error: message });
    throw error;
  }
}
