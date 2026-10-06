import type { Candle } from './candle';
import type { FeedStatus, HistorySourceName, LiveProviderName } from './feed';

export type CandleHandler = (candle: Candle, meta: { closed: boolean }) => void;

/** Streams M1 candles into the engine (replay, Twelve Data, mock). */
export interface LiveMarketDataProvider {
  readonly name: LiveProviderName;
  /** When true the UI shows a loud MOCK DATA badge. Never true for replay/live. */
  readonly isMock: boolean;
  /** Historical M1 bars that precede the live stream (ascending), so the engine starts warm. */
  warmup(bars: number): Promise<Candle[]>;
  start(onCandle: CandleHandler): Promise<void>;
  stop(): Promise<void>;
  status(): FeedStatus;
}

/** Replay-only transport controls, exposed through the REST API when the provider supports them. */
export interface ReplayControls {
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  restart(): Promise<void>;
}

export function hasReplayControls(provider: LiveMarketDataProvider): provider is LiveMarketDataProvider & ReplayControls {
  return typeof (provider as Partial<ReplayControls>).play === 'function';
}

/** Fetches historical M1 candles for the ingest pipeline. */
export interface HistoricalDataProvider {
  readonly name: HistorySourceName;
  /** Flagged adapters use undocumented endpoints and may break at any time. */
  readonly unofficial: boolean;
  fetchHistory(from: Date, to: Date): Promise<Candle[]>;
}
