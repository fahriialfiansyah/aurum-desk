import { aggregateCandles } from '@aurum/engine';
import { describe, expect, test } from 'vitest';
import { MarketFeed } from '../src/market/feed';
import { T0, m1Series } from './helpers';

describe('MarketFeed', () => {
  test('loadHistory splits closed buckets from the forming one', () => {
    const feed = new MarketFeed();
    feed.loadHistory(m1Series(17)); // 10:00..10:16 → M5 closed: 10:00, 10:05, 10:10; forming 10:15
    expect(feed.size()).toEqual({ M1: 17, M5: 3, M15: 1, M30: 0 });
    expect(feed.forming('M5')?.time).toBe(T0 + 15 * 60);
    expect(feed.forming('M15')?.time).toBe(T0 + 15 * 60);
    expect(feed.forming('M30')?.time).toBe(T0);
    expect(feed.candlesWithForming('M30')).toHaveLength(1);
  });

  test('push closes derived bars exactly on their last minute and matches aggregateCandles', () => {
    const feed = new MarketFeed();
    const series = m1Series(60);
    const closes: Record<string, number[]> = { M5: [], M15: [], M30: [] };
    for (const c of series) {
      for (const ev of feed.push(c, true)) {
        if (ev.closed && ev.tf !== 'M1') closes[ev.tf]!.push(ev.candle.time);
      }
    }
    expect(closes.M5).toEqual(aggregateCandles(series, 'M5').map((c) => c.time));
    expect(closes.M15).toEqual(aggregateCandles(series, 'M15').map((c) => c.time));
    expect(closes.M30).toEqual(aggregateCandles(series, 'M30').map((c) => c.time));
    expect(feed.closedCandles('M30')).toEqual(aggregateCandles(series, 'M30'));
    expect(feed.forming('M5')).toBeNull();
  });

  test('forming snapshots update derived bars without being counted twice', () => {
    const feed = new MarketFeed();
    const [a, b] = m1Series(2);
    feed.push(a!, true);
    const snapshot = { ...b!, high: b!.high + 5, close: b!.close + 4 };
    const events = feed.push(snapshot, false);
    const m5 = events.find((e) => e.tf === 'M5')!;
    expect(m5.closed).toBe(false);
    expect(m5.candle.high).toBeCloseTo(snapshot.high);
    expect(m5.candle.volume).toBeCloseTo(a!.volume + snapshot.volume);
    expect(feed.lastPrice()).toBeCloseTo(snapshot.close);
    // closing the real bar replaces the snapshot
    feed.push(b!, true);
    expect(feed.forming('M5')?.high).toBeCloseTo(Math.max(a!.high, b!.high));
    expect(feed.lastPrice()).toBeCloseTo(b!.close);
  });

  test('a gap (missing final minute) closes the stale bucket when the next bucket starts', () => {
    const feed = new MarketFeed();
    const series = m1Series(12); // 10:00..10:11
    for (const c of series.slice(0, 4)) feed.push(c, true); // 10:00..10:03 (10:04 missing)
    const events = feed.push(series[5]!, true); // 10:05 → new M5 bucket
    const m5 = events.filter((e) => e.tf === 'M5');
    expect(m5.map((e) => e.closed)).toEqual([true, false]);
    expect(m5[0]?.candle.time).toBe(T0);
    expect(feed.closedCandles('M5')).toHaveLength(1);
  });

  test('ignores stale bars and replaces a re-sent last bar', () => {
    const feed = new MarketFeed();
    const [a, b] = m1Series(2);
    feed.push(a!, true);
    feed.push(b!, true);
    expect(feed.push(a!, true)).toEqual([]);
    feed.push({ ...b!, close: b!.close + 1 }, true);
    expect(feed.size().M1).toBe(2);
    expect(feed.lastClosedM1()?.close).toBeCloseTo(b!.close + 1);
  });

  test('trims history to maxM1', () => {
    const feed = new MarketFeed({ maxM1: 100 });
    for (const c of m1Series(130)) feed.push(c, true);
    expect(feed.size().M1).toBeLessThanOrEqual(110);
  });
});

describe('MarketFeed — replaced last bar', () => {
  test('re-sending the last M1 bar rebuilds the forming buckets instead of double-merging', () => {
    const feed = new MarketFeed();
    const series = m1Series(3);
    for (const c of series) feed.push(c, true);
    const before = feed.forming('M5')!;
    const events = feed.push({ ...series[2]!, high: series[2]!.high + 10 }, true);
    const after = feed.forming('M5')!;
    expect(after.volume).toBeCloseTo(before.volume); // not counted twice
    expect(after.high).toBeCloseTo(series[2]!.high + 10);
    expect(events.find((e) => e.tf === 'M5')?.closed).toBe(false);
  });
});
