import { createDb, listRecentIngestRuns, pingDb } from '@aurum/db';
import { nowSec, secFromIso } from '@aurum/shared';
import { resolveFromWorkspaceRoot } from '@aurum/shared/node';
import { parseArgs } from 'node:util';
import { createAlerter } from './alerts';
import { exportCsv } from './commands/export-csv';
import { loadIngestEnv, type IngestEnv } from './config/env';
import { createLogger } from './logger';
import { listGaps, runBackfill, runIncremental, runReconcile } from './pipeline/jobs';
import { createDbStore } from './pipeline/store';
import { createHistoryProvider } from './providers';
import { startScheduler } from './scheduler';

const USAGE = `aurum-desk ingest

  pnpm ingest backfill   [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--source dukascopy]
  pnpm ingest incremental [--source dukascopy]
  pnpm ingest reconcile  [--days 30] [--source dukascopy]
  pnpm ingest gaps       [--days 30] [--source dukascopy]      (laporan saja)
  pnpm ingest export-csv --from YYYY-MM-DD --to YYYY-MM-DD --out data/xauusd-m1-sample.csv [--source dukascopy]
  pnpm ingest status
  pnpm ingest serve      (cron: incremental + reconcile + freshness alert)
`;

function dateArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return secFromIso(`${value}T00:00:00.000Z`);
  return secFromIso(value);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      source: { type: 'string' },
      days: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (!command || values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const env: IngestEnv = loadIngestEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV !== 'production');
  const handle = createDb(env.DATABASE_URL);
  if (!(await pingDb(handle.pool))) {
    throw new Error(`Tidak bisa terhubung ke database (${env.DATABASE_URL.replace(/:\/\/.*@/, '://***@')}). Jalankan: pnpm db:up && pnpm db:migrate`);
  }
  const alerter = createAlerter(env, logger);
  const sources = values.source ? [values.source] : env.INGEST_SOURCES;
  const jobs = sources.map((source) => {
    const provider = createHistoryProvider(source as IngestEnv['INGEST_SOURCES'][number], env);
    return { provider, store: createDbStore(handle, env.SYMBOL, source) };
  });
  const now = nowSec();

  try {
    switch (command) {
      case 'backfill': {
        const fromSec = dateArg(values.from, secFromIso(`${env.INGEST_BACKFILL_FROM}T00:00:00.000Z`));
        const toSec = dateArg(values.to, now);
        for (const { provider, store } of jobs) {
          logger.info({ source: store.source, from: new Date(fromSec * 1000), to: new Date(toSec * 1000) }, 'backfill mulai');
          const summary = await runBackfill({
            provider,
            store,
            fromSec,
            toSec,
            nowSec: now,
            logger,
            onChunk: (c) =>
              logger.info(
                { from: new Date(c.fromSec * 1000).toISOString().slice(0, 10), skipped: c.skipped, fetched: c.fetched, written: c.written },
                'chunk',
              ),
          });
          logger.info({ source: store.source, rows: summary.rowsWritten, rejected: summary.rejected, anomalies: summary.anomalies }, 'backfill selesai');
        }
        break;
      }
      case 'incremental': {
        for (const { provider, store } of jobs) {
          const summary = await runIncremental({ provider, store, nowSec: now, logger });
          logger.info({ source: store.source, rows: summary.rowsWritten }, 'incremental selesai');
        }
        break;
      }
      case 'reconcile': {
        const lookbackDays = values.days ? Number(values.days) : env.RECONCILE_LOOKBACK_DAYS;
        for (const { provider, store } of jobs) {
          const summary = await runReconcile({ provider, store, nowSec: now, logger, lookbackDays });
          logger.info({ source: store.source, ...summary }, 'reconcile selesai');
        }
        break;
      }
      case 'gaps': {
        const lookbackDays = values.days ? Number(values.days) : env.RECONCILE_LOOKBACK_DAYS;
        for (const { store } of jobs) {
          const gaps = await listGaps(store, now, { lookbackDays });
          const totalMinutes = gaps.reduce((acc, g) => acc + g.minutes, 0);
          logger.info({ source: store.source, gaps: gaps.length, missingMinutes: totalMinutes }, 'laporan gap');
          for (const g of gaps.slice(0, 50)) {
            logger.info({ from: new Date(g.fromSec * 1000).toISOString(), to: new Date(g.toSec * 1000).toISOString(), minutes: g.minutes }, 'gap');
          }
        }
        break;
      }
      case 'export-csv': {
        if (!values.from || !values.to || !values.out) throw new Error('export-csv membutuhkan --from, --to, --out');
        const source = sources[0] ?? 'dukascopy';
        const rows = await exportCsv(handle.db, {
          symbol: env.SYMBOL,
          source,
          fromSec: dateArg(values.from, now),
          toSec: dateArg(values.to, now),
          outPath: resolveFromWorkspaceRoot(values.out),
        });
        logger.info({ rows, out: values.out }, 'export selesai');
        break;
      }
      case 'status': {
        for (const { store } of jobs) {
          const latest = await store.latestTime();
          logger.info({ source: store.source, latest: latest ? new Date(latest * 1000).toISOString() : null }, 'status');
        }
        const runs = await listRecentIngestRuns(handle.db, 10);
        for (const run of runs) logger.info({ id: run.id, source: run.source, kind: run.kind, status: run.status, rows: run.rowsWritten, error: run.error }, 'run');
        break;
      }
      case 'serve': {
        const scheduler = startScheduler({ env, logger, alerter, jobs });
        for (const { provider, store } of jobs) {
          runIncremental({ provider, store, nowSec: nowSec(), logger }).catch((error: unknown) =>
            logger.error({ error: error instanceof Error ? error.message : String(error) }, 'incremental awal gagal'),
          );
        }
        const shutdown = async () => {
          logger.info('berhenti…');
          await scheduler.stop();
          await handle.close();
          process.exit(0);
        };
        process.on('SIGINT', () => void shutdown());
        process.on('SIGTERM', () => void shutdown());
        return; // keep process alive
      }
      default:
        process.stdout.write(USAGE);
        throw new Error(`Perintah tidak dikenal: ${command}`);
    }
  } finally {
    if (command !== 'serve') await handle.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[ingest] ${message}\n`);
  process.exit(1);
});
