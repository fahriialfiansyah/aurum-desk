import { desc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { anomalies, ingestRuns, rawIngest } from '../schema';

export type IngestRunKind = 'backfill' | 'incremental' | 'gaps' | 'import' | 'reconcile';

export async function startIngestRun(db: Db, source: string, kind: IngestRunKind, meta?: unknown): Promise<number> {
  const [row] = await db
    .insert(ingestRuns)
    .values({ source, kind, status: 'running', meta: meta ?? null })
    .returning({ id: ingestRuns.id });
  if (!row) throw new Error('failed to insert ingest run');
  return row.id;
}

export async function finishIngestRun(
  db: Db,
  id: number,
  result: { status: 'ok' | 'failed'; rowsWritten: number; error?: string; meta?: unknown },
): Promise<void> {
  await db
    .update(ingestRuns)
    .set({
      finished: new Date(),
      status: result.status,
      rowsWritten: result.rowsWritten,
      error: result.error ?? null,
      ...(result.meta !== undefined ? { meta: result.meta } : {}),
    })
    .where(eq(ingestRuns.id, id));
}

export async function listRecentIngestRuns(db: Db, limit = 20) {
  return db.select().from(ingestRuns).orderBy(desc(ingestRuns.started)).limit(limit);
}

export async function storeRawIngest(
  db: Db,
  args: { source: string; rangeFrom: Date; rangeTo: Date; rowCount: number; payload: unknown },
): Promise<void> {
  await db.insert(rawIngest).values(args);
}

export type AnomalyInput = { symbol: string; source: string; tsSec: number; kind: string; detail?: unknown };

export async function recordAnomalies(db: Db, items: readonly AnomalyInput[]): Promise<void> {
  if (items.length === 0) return;
  await db.insert(anomalies).values(
    items.map((a) => ({
      symbol: a.symbol,
      source: a.source,
      ts: new Date(a.tsSec * 1000),
      kind: a.kind,
      detail: a.detail ?? null,
    })),
  );
}
