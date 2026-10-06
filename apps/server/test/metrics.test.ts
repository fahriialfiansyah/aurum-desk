import { describe, expect, test } from 'vitest';
import { MarketFeed } from '../src/market/feed';
import { computeMetrics } from '../src/metrics';
import { SetupStore } from '../src/state/setup-store';
import { m1Series } from './helpers';

describe('computeMetrics', () => {
  test('derives price, change, session and journal stats', () => {
    const feed = new MarketFeed();
    feed.loadHistory(m1Series(400));
    const setups = new SetupStore();
    const m = computeMetrics({
      symbol: 'XAUUSD',
      feed,
      setups,
      feedStatus: () => ({ provider: 'replay', isMock: false, source: 'csv', connected: true, lastCandleTime: null, lagSec: null }),
      llmSpend: () => ({ inputTokens: 0, outputTokens: 0, calls: 0, estimatedUsd: 0, dailyBudgetTokens: 1, provider: 'none', model: null }),
      nowSec: () => 0,
    });
    expect(m.symbol).toBe('XAUUSD');
    expect(m.lastPrice).not.toBeNull();
    expect(m.change).not.toBeNull();
    expect(m.atrM15).not.toBeNull();
    expect(m.session).toBe('newyork'); // 10:00 UTC + 400 min ≈ 16:39 UTC
    expect(m.winRate).toBeNull();
    expect(m.journalCount).toBe(0);
    expect(m.feed.isMock).toBe(false);
  });
});
