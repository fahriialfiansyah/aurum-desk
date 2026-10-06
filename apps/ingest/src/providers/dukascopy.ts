import type { Candle, HistoricalDataProvider } from '@aurum/shared';
import { getHistoricalRates } from 'dukascopy-node';

export const DUKASCOPY_INSTRUMENT = 'xauusd' as const;
const BATCH_SIZE = 10;
const PAUSE_BETWEEN_BATCHES_MS = 500;
/** Our own retry (network/5xx). The library's retry is kept OFF because it turns weekend 404s into errors. */
export const FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

export type DukascopyOptions = {
  priceType?: 'bid' | 'ask';
  cacheDir?: string;
  useCache?: boolean;
  /** Injected for tests. */
  fetchRates?: typeof getHistoricalRates;
  sleep?: (ms: number) => Promise<void>;
};

type RawRow = { timestamp: number; open: number; high: number; low: number; close: number; volume?: number };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Official, free Dukascopy historical feed (bi5 files) via `dukascopy-node`.
 * Returns raw M1 bars (3-decimal prices as quoted); validation happens in the pipeline.
 * `to` is exclusive, matching the library.
 */
export class DukascopyProvider implements HistoricalDataProvider {
  readonly name = 'dukascopy' as const;
  readonly unofficial = false;
  private readonly options: Required<Omit<DukascopyOptions, 'fetchRates' | 'sleep'>>;
  private readonly fetchRates: typeof getHistoricalRates;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: DukascopyOptions = {}) {
    this.options = {
      priceType: options.priceType ?? 'bid',
      cacheDir: options.cacheDir ?? './data/cache/dukascopy',
      useCache: options.useCache ?? false,
    };
    this.fetchRates = options.fetchRates ?? getHistoricalRates;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async fetchHistory(from: Date, to: Date): Promise<Candle[]> {
    const rows = await this.withRetry(() =>
      this.fetchRates({
        instrument: DUKASCOPY_INSTRUMENT,
        dates: { from, to },
        timeframe: 'm1',
        priceType: this.options.priceType,
        volumes: true,
        format: 'json',
        ignoreFlats: true,
        useCache: this.options.useCache,
        cacheFolderPath: this.options.cacheDir,
        batchSize: BATCH_SIZE,
        pauseBetweenBatchesMs: PAUSE_BETWEEN_BATCHES_MS,
        retryCount: 0,
        retryOnEmpty: false,
      }),
    );
    return (rows as RawRow[]).map((r) => ({
      time: Math.floor(r.timestamp / 1000),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? 0,
    }));
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < FETCH_ATTEMPTS) await this.sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
    const message = lastError instanceof Error ? lastError.message : JSON.stringify(lastError);
    throw new Error(`Dukascopy fetch gagal setelah ${FETCH_ATTEMPTS} percobaan: ${message}`);
  }
}
