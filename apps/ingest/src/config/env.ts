import { HISTORY_SOURCE_NAMES, HistorySourceNameSchema } from '@aurum/shared';
import { envBoolean, envEnum, envInt, envList, envString, loadDotenv, optionalString, parseEnv } from '@aurum/shared/node';
import { z } from 'zod';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;

export const ingestEnvSchema = z.object({
  DATABASE_URL: z.url({ message: 'DATABASE_URL harus berupa URL postgres://…' }),
  SYMBOL: envString('XAUUSD'),
  INGEST_SOURCES: envList(['dukascopy']).pipe(z.array(HistorySourceNameSchema).min(1)),
  INGEST_BACKFILL_FROM: envString('2024-01-01').pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format YYYY-MM-DD')),
  INGEST_CRON_INCREMENTAL: envString('*/5 * * * *'),
  INGEST_CRON_RECONCILE: envString('0 2 * * *'),
  TWELVEDATA_API_KEY: optionalString,
  TWELVEDATA_PAUSE_MS: envInt(8000),
  MT5_CSV_PATH: optionalString,
  /** Broker server time minus UTC, in minutes (EET 120, EEST 180). */
  MT5_TIME_OFFSET_MINUTES: envInt(0),
  TRADINGVIEW_SYMBOL: envString('OANDA:XAUUSD'),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  TRADINGVIEW_ENABLED: envBoolean(false),
  LOG_LEVEL: envEnum(LOG_LEVELS, 'info'),
  DUKASCOPY_CACHE_DIR: envString('./data/cache/dukascopy'),
  STALE_FEED_MINUTES: envInt(60),
  RECONCILE_LOOKBACK_DAYS: envInt(30),
  NODE_ENV: envString('development'),
});

export type IngestEnv = z.output<typeof ingestEnvSchema>;

export function loadIngestEnv(source: Record<string, string | undefined> = process.env): IngestEnv {
  loadDotenv();
  const env = parseEnv(ingestEnvSchema, source, 'ingest');
  const unknownSources = env.INGEST_SOURCES.filter((s) => !HISTORY_SOURCE_NAMES.includes(s));
  if (unknownSources.length > 0) {
    throw new Error(`INGEST_SOURCES tidak dikenal: ${unknownSources.join(', ')}`);
  }
  assertTradingViewNotAlone(env.INGEST_SOURCES);
  return env;
}

/** The unofficial TradingView adapter may complement an official source, never replace it. */
export function assertTradingViewNotAlone(sources: readonly string[]): void {
  if (sources.includes('tradingview') && !sources.some((s) => s !== 'tradingview')) {
    throw new Error('INGEST_SOURCES tidak boleh hanya "tradingview" — adapter tidak resmi harus mendampingi sumber resmi (dukascopy/twelvedata/mt5csv).');
  }
}
