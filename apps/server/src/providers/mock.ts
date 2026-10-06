import { bucketStart, type Candle, type CandleHandler, type FeedStatus, type LiveMarketDataProvider } from '@aurum/shared';

const MINUTE = 60;
export const MOCK_DEFAULT_PRICE = 3400;
const MOCK_DEFAULT_VOL_PER_MIN = 0.9; // ≈ typical XAUUSD M1 range in dollars
const PRICE_DECIMALS = 3;

/** Small deterministic PRNG so tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(n: number): number {
  const f = 10 ** PRICE_DECIMALS;
  return Math.round(n * f) / f;
}

export type MockOptions = {
  startPrice?: number;
  seed?: number;
  /** Wall-clock milliseconds between emitted M1 bars (bars still carry 60 s timestamps). */
  intervalMs?: number;
  startTime?: number;
  source?: string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Synthetic random-walk candles. ONLY for unit tests and explicit dev use
 * (`MARKET_DATA_PROVIDER=mock`). `isMock` is true so the UI shows a loud MOCK DATA badge.
 */
export class MockProvider implements LiveMarketDataProvider {
  readonly name = 'mock' as const;
  readonly isMock = true;
  private readonly rand: () => number;
  private readonly intervalMs: number;
  private readonly source: string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private price: number;
  private nextTime: number;
  private timer: unknown = null;
  private running = false;
  private lastEmitted: number | null = null;

  constructor(options: MockOptions = {}) {
    this.rand = mulberry32(options.seed ?? 42);
    this.intervalMs = options.intervalMs ?? 500;
    this.source = options.source ?? 'mock';
    this.price = options.startPrice ?? MOCK_DEFAULT_PRICE;
    this.nextTime = bucketStart(options.startTime ?? Math.floor(Date.now() / 1000), 'M1');
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  }

  private nextBar(time: number): Candle {
    const open = this.price;
    const drift = (this.rand() - 0.5) * 2 * MOCK_DEFAULT_VOL_PER_MIN;
    const close = round(open + drift);
    const wick = this.rand() * MOCK_DEFAULT_VOL_PER_MIN;
    const high = round(Math.max(open, close) + wick * this.rand());
    const low = round(Math.min(open, close) - wick * this.rand());
    this.price = close;
    return { time, open, high, low, close, volume: round(this.rand() * 2) };
  }

  async warmup(bars: number): Promise<Candle[]> {
    const start = this.nextTime - bars * MINUTE;
    const out: Candle[] = [];
    for (let t = start; t < this.nextTime; t += MINUTE) out.push(this.nextBar(t));
    return out;
  }

  async start(onCandle: CandleHandler): Promise<void> {
    this.running = true;
    const emit = () => {
      if (!this.running) return;
      const bar = this.nextBar(this.nextTime);
      this.nextTime += MINUTE;
      this.lastEmitted = bar.time;
      onCandle(bar, { closed: true });
      this.timer = this.setTimer(emit, this.intervalMs);
    };
    this.timer = this.setTimer(emit, this.intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  status(): FeedStatus {
    return {
      provider: 'mock',
      isMock: true,
      source: this.source,
      connected: this.running,
      lastCandleTime: this.lastEmitted,
      lagSec: null,
      message: 'MOCK DATA — data sintetis, bukan harga pasar',
    };
  }
}
