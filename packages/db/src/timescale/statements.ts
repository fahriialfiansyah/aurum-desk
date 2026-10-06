import { TIMEFRAME_MINUTES, type Timeframe } from '@aurum/shared';

export const DERIVED_CANDLE_VIEWS: Record<Exclude<Timeframe, 'M1'>, string> = {
  M5: 'candles_m5',
  M15: 'candles_m15',
  M30: 'candles_m30',
};

export const HYPERTABLE_STATEMENTS: readonly string[] = [
  `CREATE EXTENSION IF NOT EXISTS timescaledb;`,
  `SELECT create_hypertable('candles_m1', by_range('ts', INTERVAL '7 days'), if_not_exists => TRUE, migrate_data => TRUE);`,
];

/** Continuous aggregate DDL for one derived timeframe. Must run outside a transaction. */
export function continuousAggregateSql(tf: Exclude<Timeframe, 'M1'>): string {
  const minutes = TIMEFRAME_MINUTES[tf];
  const view = DERIVED_CANDLE_VIEWS[tf];
  return `CREATE MATERIALIZED VIEW ${view}
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT symbol,
       source,
       time_bucket(INTERVAL '${minutes} minutes', ts) AS ts,
       first(open, ts)  AS open,
       max(high)        AS high,
       min(low)         AS low,
       last(close, ts)  AS close,
       sum(volume)      AS volume
FROM candles_m1
GROUP BY symbol, source, time_bucket(INTERVAL '${minutes} minutes', ts)
WITH NO DATA;`;
}

export function refreshPolicySql(tf: Exclude<Timeframe, 'M1'>): string {
  const view = DERIVED_CANDLE_VIEWS[tf];
  return `SELECT add_continuous_aggregate_policy('${view}',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);`;
}

export function refreshAllSql(tf: Exclude<Timeframe, 'M1'>): string {
  return `CALL refresh_continuous_aggregate('${DERIVED_CANDLE_VIEWS[tf]}', NULL, NULL);`;
}

export const CAGG_EXISTS_SQL = `SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = $1;`;
