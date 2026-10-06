import type { Candle, CandleHandler, FeedStatus, LiveMarketDataProvider, ReplayControls, ReplayState } from '@aurum/shared';

const MINUTE_MS = 60_000;
/** Below this speed each M1 bar is streamed as 4 forming updates (open → high → low → close). */
export const INTRABAR_MAX_SPEED = 60;
const INTRABAR_STEPS = 4;
export const REPLAY_SPEEDS = [1, 5, 20, 100, 600] as const;

export type ReplayOptions = {
  /** Full ascending M1 history to replay (real data only). */
  candles: readonly Candle[];
  /** Real-time multiplier: 1 = one bar per minute, 20 = one bar per 3 s. */
  speed: number;
  /** Bars before `startTime` (or the first `warmupBars`) are history, the rest is streamed. */
  warmupBars: number;
  startTime?: number;
  source: string;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Splits a closed bar into forming snapshots along an open→high→low→close path. */
export function formingSteps(bar: Candle): Candle[] {
  const bullish = bar.close >= bar.open;
  const first = bullish ? bar.low : bar.high;
  const second = bullish ? bar.high : bar.low;
  const vol = bar.volume / INTRABAR_STEPS;
  const step1: Candle = { time: bar.time, open: bar.open, high: bar.open, low: bar.open, close: bar.open, volume: vol };
  const step2: Candle = { ...step1, high: Math.max(bar.open, first), low: Math.min(bar.open, first), close: first, volume: vol * 2 };
  const step3: Candle = { ...step2, high: Math.max(step2.high, second), low: Math.min(step2.low, second), close: second, volume: vol * 3 };
  return [step1, step2, step3, bar];
}

/**
 * Replays REAL historical M1 candles at a configurable speed. Never synthesises data.
 * Emits `closed:false` snapshots for a lively chart at low speeds and `closed:true` once per bar.
 */
export class ReplayProvider implements LiveMarketDataProvider, ReplayControls {
  readonly name = 'replay' as const;
  readonly isMock = false;
  private readonly candles: readonly Candle[];
  private readonly warmupCount: number;
  private readonly source: string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private speed: number;
  private position: number;
  private playing = false;
  private started = false;
  private timer: unknown = null;
  private handler: CandleHandler | null = null;
  private lastEmitted: number | null = null;

  constructor(options: ReplayOptions) {
    if (options.candles.length === 0) throw new Error('ReplayProvider membutuhkan minimal satu candle');
    if (options.speed <= 0) throw new RangeError('speed harus > 0');
    this.candles = options.candles;
    this.speed = options.speed;
    this.source = options.source;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    const startIndex =
      options.startTime !== undefined
        ? Math.max(0, this.candles.findIndex((c) => c.time >= options.startTime!))
        : Math.min(options.warmupBars, this.candles.length - 1);
    this.warmupCount = startIndex;
    this.position = startIndex;
  }

  async warmup(bars: number): Promise<Candle[]> {
    const from = Math.max(0, this.warmupCount - bars);
    return this.candles.slice(from, this.warmupCount);
  }

  async start(onCandle: CandleHandler): Promise<void> {
    this.handler = onCandle;
    this.started = true;
    this.play();
  }

  async stop(): Promise<void> {
    this.pause();
    this.started = false;
    this.handler = null;
  }

  play(): void {
    if (!this.started || this.playing) return;
    if (this.position >= this.candles.length) return;
    this.playing = true;
    this.scheduleNext(0);
  }

  pause(): void {
    this.playing = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  setSpeed(speed: number): void {
    if (speed <= 0 || !Number.isFinite(speed)) throw new RangeError('speed harus > 0');
    this.speed = speed;
  }

  async restart(): Promise<void> {
    this.pause();
    this.position = this.warmupCount;
    this.lastEmitted = null;
    this.play();
  }

  replayState(): ReplayState {
    return {
      playing: this.playing,
      speed: this.speed,
      cursorTime: this.lastEmitted,
      startTime: this.candles[this.warmupCount]?.time ?? null,
      endTime: this.candles[this.candles.length - 1]?.time ?? null,
      totalCandles: this.candles.length - this.warmupCount,
      position: this.position - this.warmupCount,
    };
  }

  status(): FeedStatus {
    const finished = this.position >= this.candles.length;
    return {
      provider: 'replay',
      isMock: false,
      source: this.source,
      connected: this.started && !finished,
      lastCandleTime: this.lastEmitted,
      lagSec: null,
      message: finished ? 'Replay selesai' : this.playing ? `Replay ${this.speed}×` : 'Replay dijeda',
      replay: this.replayState(),
    };
  }

  private scheduleNext(delayMs: number): void {
    this.timer = this.setTimer(() => this.tick(), delayMs);
  }

  private tick(): void {
    this.timer = null;
    if (!this.playing || !this.handler) return;
    const bar = this.candles[this.position];
    if (!bar) {
      this.playing = false;
      return;
    }
    const barDurationMs = MINUTE_MS / this.speed;
    if (this.speed <= INTRABAR_MAX_SPEED) {
      this.emitForming(bar, barDurationMs);
      return;
    }
    this.emitClosed(bar);
    this.scheduleNext(barDurationMs);
  }

  private emitForming(bar: Candle, barDurationMs: number): void {
    const steps = formingSteps(bar);
    const stepMs = barDurationMs / INTRABAR_STEPS;
    let i = 0;
    const next = () => {
      if (!this.playing || !this.handler) return;
      const snapshot = steps[i];
      if (!snapshot) return;
      i += 1;
      if (i < steps.length) {
        this.handler(snapshot, { closed: false });
        this.timer = this.setTimer(next, stepMs);
        return;
      }
      this.emitClosed(bar);
      this.scheduleNext(stepMs);
    };
    next();
  }

  private emitClosed(bar: Candle): void {
    this.position += 1;
    this.lastEmitted = bar.time;
    this.handler?.(bar, { closed: true });
  }
}
