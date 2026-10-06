import { type HistoricalDataProvider, type HistorySourceName } from '@aurum/shared';
import { resolveFromWorkspaceRoot } from '@aurum/shared/node';
import type { IngestEnv } from '../config/env';
import { DukascopyProvider } from './dukascopy';

/** Builds the historical provider for a source name. Non-Dukascopy sources arrive in later phases. */
export function createHistoryProvider(source: HistorySourceName, env: IngestEnv): HistoricalDataProvider {
  switch (source) {
    case 'dukascopy':
      return new DukascopyProvider({ cacheDir: resolveFromWorkspaceRoot(env.DUKASCOPY_CACHE_DIR) });
    case 'twelvedata':
    case 'mt5csv':
    case 'tradingview':
      throw new Error(`Sumber '${source}' belum tersedia di fase ini (lihat docs/PLAN.md P6).`);
    default: {
      const never: never = source;
      throw new Error(`Sumber tidak dikenal: ${String(never)}`);
    }
  }
}
