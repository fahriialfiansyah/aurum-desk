import type { Candle, HistoricalDataProvider } from '@aurum/shared';
import { TWELVEDATA_MAX_OUTPUTSIZE, TwelveDataError, type TwelveDataClient } from '@aurum/shared/node';

const MINUTE = 60;
/** Free plan: 8 credits/minute → one request every ~8 s keeps a backfill under the limit. */
export const TWELVEDATA_DEFAULT_PAUSE_MS = 8000;
const RATE_LIMIT_WAIT_MS = 61_000;

export type TwelveDataHistoryOptions = {
  client: Pick<TwelveDataClient, 'timeSeries'>;
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Official Twelve Data REST history (M1), paged in ≤5000-minute windows with rate-limit pacing. */
export class TwelveDataHistoryProvider implements HistoricalDataProvider {
  readonly name = 'twelvedata' as const;
  readonly unofficial = false;
  private readonly client: Pick<TwelveDataClient, 'timeSeries'>;
  private readonly pauseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: TwelveDataHistoryOptions) {
    this.client = options.client;
    this.pauseMs = options.pauseMs ?? TWELVEDATA_DEFAULT_PAUSE_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async fetchHistory(from: Date, to: Date): Promise<Candle[]> {
    const fromSec = Math.floor(from.getTime() / 1000);
    const toSec = Math.floor(to.getTime() / 1000);
    const windowSec = TWELVEDATA_MAX_OUTPUTSIZE * MINUTE;
    const out: Candle[] = [];
    for (let a = fromSec; a < toSec; a += windowSec) {
      const b = Math.min(a + windowSec, toSec);
      out.push(...(await this.fetchWindow(a, b)));
      if (b < toSec) await this.sleep(this.pauseMs);
    }
    return out.filter((c) => c.time >= fromSec && c.time < toSec);
  }

  private async fetchWindow(fromSec: number, toSec: number): Promise<Candle[]> {
    const nowSec = Math.floor(this.now() / 1000);
    try {
      return await this.client.timeSeries({ fromSec, toSec, outputsize: TWELVEDATA_MAX_OUTPUTSIZE, nowSec });
    } catch (error) {
      if (error instanceof TwelveDataError && error.isRateLimit) {
        await this.sleep(RATE_LIMIT_WAIT_MS);
        return this.client.timeSeries({ fromSec, toSec, outputsize: TWELVEDATA_MAX_OUTPUTSIZE, nowSec });
      }
      throw error;
    }
  }
}
