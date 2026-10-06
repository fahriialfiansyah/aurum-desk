import { nowSec } from '@aurum/shared';
import cron from 'node-cron';
import type { Alerter } from './alerts';
import type { IngestEnv } from './config/env';
import type { Logger } from './logger';
import { checkFreshness, runIncremental, runReconcile } from './pipeline/jobs';
import type { IngestStore } from './pipeline/store';
import type { HistoricalDataProvider } from '@aurum/shared';

export type SchedulerDeps = {
  env: IngestEnv;
  logger: Logger;
  alerter: Alerter;
  jobs: Array<{ provider: HistoricalDataProvider; store: IngestStore }>;
};

const FRESHNESS_CRON = '*/15 * * * *';

function assertCron(expression: string, name: string): void {
  if (!cron.validate(expression)) throw new Error(`${name} bukan ekspresi cron yang valid: "${expression}"`);
}

/** Plain in-process cron: incremental every N minutes, reconcile daily, freshness check every 15 minutes. */
export function startScheduler(deps: SchedulerDeps): { stop: () => Promise<void> } {
  const { env, logger, alerter, jobs } = deps;
  assertCron(env.INGEST_CRON_INCREMENTAL, 'INGEST_CRON_INCREMENTAL');
  assertCron(env.INGEST_CRON_RECONCILE, 'INGEST_CRON_RECONCILE');

  const guarded = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      const result = await fn();
      logger.info({ job: name, result }, 'job selesai');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ job: name, error: message }, 'job gagal');
      await alerter.notify(`Job ${name} gagal: ${message}`);
    }
  };

  const runAll = (name: string, run: (job: SchedulerDeps['jobs'][number]) => Promise<unknown>) =>
    guarded(name, async () => Promise.all(jobs.map((job) => run(job))));

  const tasks = [
    cron.schedule(
      env.INGEST_CRON_INCREMENTAL,
      runAll('incremental', ({ provider, store }) => runIncremental({ provider, store, nowSec: nowSec(), logger })),
      { timezone: 'UTC', noOverlap: true },
    ),
    cron.schedule(
      env.INGEST_CRON_RECONCILE,
      runAll('reconcile', ({ provider, store }) =>
        runReconcile({ provider, store, nowSec: nowSec(), logger, lookbackDays: env.RECONCILE_LOOKBACK_DAYS }),
      ),
      { timezone: 'UTC', noOverlap: true },
    ),
    cron.schedule(
      FRESHNESS_CRON,
      guarded('freshness', async () => {
        for (const { store } of jobs) {
          const report = await checkFreshness(store, nowSec(), env.STALE_FEED_MINUTES);
          if (report.stale) {
            await alerter.notify(
              `Data ${store.source} basi: candle terbaru ${report.ageMinutes ?? '∞'} menit yang lalu (pasar buka).`,
            );
          }
        }
      }),
      { timezone: 'UTC', noOverlap: true },
    ),
  ];
  logger.info(
    { incremental: env.INGEST_CRON_INCREMENTAL, reconcile: env.INGEST_CRON_RECONCILE, freshness: FRESHNESS_CRON },
    'scheduler aktif',
  );
  return {
    stop: async () => {
      await Promise.all(tasks.map((t) => t.stop()));
    },
  };
}
