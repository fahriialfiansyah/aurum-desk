import type pg from 'pg';
import {
  CAGG_EXISTS_SQL,
  DERIVED_CANDLE_VIEWS,
  HYPERTABLE_STATEMENTS,
  continuousAggregateSql,
  refreshAllSql,
  refreshPolicySql,
} from './statements';

export type TimescaleLogger = { info: (msg: string) => void; warn: (msg: string) => void };

const silentLogger: TimescaleLogger = { info: () => undefined, warn: () => undefined };

/**
 * Idempotently converts candles_m1 into a hypertable and creates the M5/M15/M30 continuous aggregates
 * with refresh policies. Each statement runs on its own (autocommit) because Timescale forbids
 * continuous-aggregate DDL inside a transaction block.
 */
export async function applyTimescale(pool: pg.Pool, logger: TimescaleLogger = silentLogger): Promise<void> {
  for (const statement of HYPERTABLE_STATEMENTS) {
    await pool.query(statement);
  }
  logger.info('hypertable candles_m1 ready');

  for (const tf of ['M5', 'M15', 'M30'] as const) {
    const view = DERIVED_CANDLE_VIEWS[tf];
    const exists = await pool.query(CAGG_EXISTS_SQL, [view]);
    if (exists.rowCount === 0) {
      await pool.query(continuousAggregateSql(tf));
      logger.info(`continuous aggregate ${view} created`);
      await pool.query(refreshAllSql(tf));
    }
    await pool.query(refreshPolicySql(tf));
  }
  logger.info('continuous aggregates ready');
}

/** Force-refresh every derived view for a time window (used after large backfills). */
export async function refreshAggregates(
  pool: pg.Pool,
  window: { fromSec: number; toSec: number } | null = null,
): Promise<void> {
  for (const tf of ['M5', 'M15', 'M30'] as const) {
    const view = DERIVED_CANDLE_VIEWS[tf];
    if (window) {
      await pool.query(`CALL refresh_continuous_aggregate('${view}', to_timestamp($1), to_timestamp($2));`, [
        window.fromSec,
        window.toSec,
      ]);
    } else {
      await pool.query(refreshAllSql(tf));
    }
  }
}
