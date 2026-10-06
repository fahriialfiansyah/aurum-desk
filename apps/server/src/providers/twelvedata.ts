import { TIMEFRAME_SECONDS, type Candle, type CandleHandler, type FeedStatus, type LiveMarketDataProvider } from '@aurum/shared';
import { TwelveDataClient, TwelveDataError } from '@aurum/shared/node';

export const TWELVEDATA_DEFAULT_POLL_MS = 15_000;
const RATE_LIMIT_BACKOFF_MS = 61_000;
const POLL_OUTPUTSIZE = 4;
const MAX_CONSECUTIVE_FAILURES = 4;

type Clock = { now: () => number; setTimer: (fn: () => void, ms: number) => unknown; clearTimer: (h: unknown) => void };

const realClock: Clock = { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as NodeJS.Timeout) };

/**
 * Live XAU/USD M1 via Twelve Data REST polling (free plan friendly: 1 credit per poll).
 * Emits closed bars once (deduplicated by open time) and the forming bar as `closed:false`.
 */
export class TwelveDataLiveProvider implements LiveMarketDataProvider {
  readonly name = 'twelvedata' as const;
  readonly isMock = false;
  private readonly client: Pick<TwelveDataClient, 'timeSeries'>;
  private readonly pollMs: number;
  private readonly clock: Clock;
  private timer: unknown = null;
  private running = false;
  private lastClosed: number | null = null;
  private failures = 0;
  private message: string | undefined;

  constructor(options: { client: Pick<TwelveDataClient, 'timeSeries'>; pollMs?: number; clock?: Clock }) {
    this.client = options.client;
    this.pollMs = options.pollMs ?? TWELVEDATA_DEFAULT_POLL_MS;
    this.clock = options.clock ?? realClock;
  }

  async warmup(bars: number): Promise<Candle[]> {
    const nowSec = Math.floor(this.clock.now() / 1000);
    const candles = await this.client.timeSeries({ outputsize: bars, nowSec });
    const last = candles[candles.length - 1];
    if (last) this.lastClosed = last.time;
    return candles;
  }

  async start(onCandle: CandleHandler): Promise<void> {
    this.running = true;
    const poll = async () => {
      if (!this.running) return;
      let delay = this.pollMs;
      try {
        const nowSec = Math.floor(this.clock.now() / 1000);
        const bars = await this.client.timeSeries({ outputsize: POLL_OUTPUTSIZE, includeForming: true, nowSec });
        for (const bar of bars) {
          const isClosed = bar.time + TIMEFRAME_SECONDS.M1 <= nowSec;
          if (isClosed) {
            if (this.lastClosed !== null && bar.time <= this.lastClosed) continue;
            this.lastClosed = bar.time;
            onCandle(bar, { closed: true });
          } else {
            onCandle(bar, { closed: false });
          }
        }
        this.failures = 0;
        this.message = undefined;
      } catch (error) {
        this.failures += 1;
        this.message = error instanceof Error ? error.message : String(error);
        if (error instanceof TwelveDataError && error.isRateLimit) delay = RATE_LIMIT_BACKOFF_MS;
      }
      if (this.running) this.timer = this.clock.setTimer(() => void poll(), delay);
    };
    this.timer = this.clock.setTimer(() => void poll(), 0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
  }

  status(): FeedStatus {
    const nowSec = Math.floor(this.clock.now() / 1000);
    return {
      provider: 'twelvedata',
      isMock: false,
      source: 'twelvedata',
      connected: this.running && this.failures < MAX_CONSECUTIVE_FAILURES,
      lastCandleTime: this.lastClosed,
      lagSec: this.lastClosed === null ? null : Math.max(0, nowSec - (this.lastClosed + TIMEFRAME_SECONDS.M1)),
      message: this.message ?? (this.running ? `Twelve Data live · polling ${Math.round(this.pollMs / 1000)}s` : 'berhenti'),
    };
  }
}
