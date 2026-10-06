import { journalStats, lastAtr } from '@aurum/engine';
import { sessionAt, type FeedStatus, type LlmSpend, type Metrics } from '@aurum/shared';
import type { MarketFeed } from './market/feed';
import type { SetupStore } from './state/setup-store';

export type MetricsDeps = {
  symbol: string;
  feed: MarketFeed;
  setups: SetupStore;
  feedStatus: () => FeedStatus;
  llmSpend: () => LlmSpend;
  /** Wall clock for "today"; in replay the candle clock is used instead. */
  nowSec: () => number;
};

const DAY_SECONDS = 86_400;

function dayStartSec(sec: number): number {
  return Math.floor(sec / DAY_SECONDS) * DAY_SECONDS;
}

export function computeMetrics(deps: MetricsDeps): Metrics {
  const { feed, setups } = deps;
  const m1 = feed.closedCandles('M1');
  const last = feed.lastPrice();
  const lastClosed = feed.lastClosedM1();
  const prevClosed = m1[m1.length - 2];
  const clockSec = lastClosed?.time ?? deps.nowSec();
  const todayStart = dayStartSec(clockSec);
  const dayOpen = m1.find((c) => c.time >= todayStart)?.open ?? null;
  const m15 = feed.closedCandles('M15', 200);
  const atrM15 = lastAtr(m15);
  const stats = journalStats(setups.journal);
  const change = last !== null && prevClosed ? last - prevClosed.close : null;
  return {
    symbol: deps.symbol,
    lastPrice: last,
    change,
    changePct: change !== null && prevClosed ? (change / prevClosed.close) * 100 : null,
    dayChange: last !== null && dayOpen !== null ? last - dayOpen : null,
    atrM15,
    spread: null,
    session: sessionAt(clockSec),
    setupsToday: setups.createdOn(new Date(todayStart * 1000).toISOString()),
    activeSetups: setups.active.length,
    winRate: stats.winRate,
    avgR: stats.avgR,
    journalCount: stats.count,
    llm: deps.llmSpend(),
    feed: deps.feedStatus(),
    serverTime: new Date().toISOString(),
  };
}
