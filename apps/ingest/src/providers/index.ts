import type { HistoricalDataProvider, HistorySourceName } from '@aurum/shared';
import { TwelveDataClient, resolveFromWorkspaceRoot } from '@aurum/shared/node';
import type { IngestEnv } from '../config/env';
import { DukascopyProvider } from './dukascopy';
import { Mt5CsvProvider } from './mt5csv';
import { TradingViewProvider } from './tradingview';
import { TwelveDataHistoryProvider } from './twelvedata';

/** Builds the historical provider for a source name. Throws a readable error when config is missing. */
export function createHistoryProvider(source: HistorySourceName, env: IngestEnv, options: { mt5Path?: string } = {}): HistoricalDataProvider {
  switch (source) {
    case 'dukascopy':
      return new DukascopyProvider({ cacheDir: resolveFromWorkspaceRoot(env.DUKASCOPY_CACHE_DIR) });
    case 'twelvedata': {
      if (!env.TWELVEDATA_API_KEY) throw new Error('TWELVEDATA_API_KEY wajib diisi untuk sumber twelvedata');
      return new TwelveDataHistoryProvider({ client: new TwelveDataClient({ apiKey: env.TWELVEDATA_API_KEY }), pauseMs: env.TWELVEDATA_PAUSE_MS });
    }
    case 'mt5csv': {
      const path = options.mt5Path ?? env.MT5_CSV_PATH;
      if (!path) throw new Error('Sumber mt5csv membutuhkan path file: `pnpm ingest import-mt5 <file>` atau MT5_CSV_PATH');
      return new Mt5CsvProvider({ path: resolveFromWorkspaceRoot(path), offsetMinutes: env.MT5_TIME_OFFSET_MINUTES });
    }
    case 'tradingview': {
      if (!env.TRADINGVIEW_ENABLED) {
        throw new Error('Adapter TradingView tidak resmi dan nonaktif. Set TRADINGVIEW_ENABLED=true hanya jika Anda menerima risikonya (lihat README).');
      }
      return new TradingViewProvider({ symbol: env.TRADINGVIEW_SYMBOL });
    }
    default: {
      const never: never = source;
      throw new Error(`Sumber tidak dikenal: ${String(never)}`);
    }
  }
}
