import { getCandles, type Db } from '@aurum/db';
import { resolveFromWorkspaceRoot, secFromIso, type Candle, type LiveMarketDataProvider } from '@aurum/shared';
import type { ServerEnv } from '../config/env';
import { loadCandleCsv } from './csv';
import { MockProvider } from './mock';
import { ReplayProvider } from './replay';

const REPLAY_POSTGRES_MAX_BARS = 100_000;

async function loadReplayCandles(env: ServerEnv, db: Db | null): Promise<Candle[]> {
  if (env.REPLAY_SOURCE === 'csv') return loadCandleCsv(resolveFromWorkspaceRoot(env.REPLAY_CSV_PATH));
  if (!db) throw new Error('REPLAY_SOURCE=postgres membutuhkan koneksi database');
  const candles = await getCandles(db, {
    symbol: env.SYMBOL,
    source: env.ENGINE_CANDLE_SOURCE,
    tf: 'M1',
    limit: REPLAY_POSTGRES_MAX_BARS,
    ...(env.REPLAY_START ? { fromSec: secFromIso(env.REPLAY_START) - env.REPLAY_WARMUP_BARS * 60 } : {}),
  });
  if (candles.length === 0) {
    throw new Error(
      `Tidak ada candle ${env.SYMBOL}/${env.ENGINE_CANDLE_SOURCE} di database. Jalankan: pnpm ingest backfill`,
    );
  }
  return candles;
}

/**
 * Builds the live feed from env. Mock is never a fallback: only an explicit
 * MARKET_DATA_PROVIDER=mock produces synthetic data.
 */
export async function createLiveProvider(env: ServerEnv, db: Db | null): Promise<LiveMarketDataProvider> {
  switch (env.MARKET_DATA_PROVIDER) {
    case 'replay': {
      const candles = await loadReplayCandles(env, db);
      return new ReplayProvider({
        candles,
        speed: env.REPLAY_SPEED,
        warmupBars: env.REPLAY_WARMUP_BARS,
        ...(env.REPLAY_START ? { startTime: secFromIso(env.REPLAY_START) } : {}),
        source: env.REPLAY_SOURCE === 'csv' ? `csv:${env.REPLAY_CSV_PATH.split('/').pop() ?? ''}` : env.ENGINE_CANDLE_SOURCE,
      });
    }
    case 'mock':
      return new MockProvider();
    case 'twelvedata':
      throw new Error('Provider twelvedata tersedia di fase P6 (docs/PLAN.md).');
    default: {
      const never: never = env.MARKET_DATA_PROVIDER;
      throw new Error(`MARKET_DATA_PROVIDER tidak dikenal: ${String(never)}`);
    }
  }
}
