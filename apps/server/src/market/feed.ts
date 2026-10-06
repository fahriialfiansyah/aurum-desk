import { aggregateCandles, isBucketComplete, mergeIntoBucket } from '@aurum/engine';
import { DERIVED_TIMEFRAMES, TIMEFRAMES, bucketStart, type Candle, type Timeframe } from '@aurum/shared';

export type FeedEvent = { tf: Timeframe; candle: Candle; closed: boolean };

type DerivedTf = (typeof DERIVED_TIMEFRAMES)[number];

export const DEFAULT_MAX_M1 = 30_000;
const TRIM_SLACK = 0.1;

/**
 * In-memory candle state: closed M1 history, derived M5/M15/M30 (closed + forming) built with the
 * same epoch-aligned buckets as the Timescale continuous aggregates. `push` returns the events that
 * must be broadcast; internal arrays are replaced, never handed out.
 */
export class MarketFeed {
  private m1: Candle[] = [];
  private closed: Record<DerivedTf, Candle[]> = { M5: [], M15: [], M30: [] };
  /** Aggregate of the CLOSED M1 bars inside the current bucket, per derived TF. */
  private bucketAcc: Partial<Record<DerivedTf, Candle>> = {};
  private formingM1: Candle | null = null;
  private readonly maxM1: number;

  constructor(options: { maxM1?: number } = {}) {
    this.maxM1 = options.maxM1 ?? DEFAULT_MAX_M1;
  }

  /** Replaces all state with an ascending M1 history (closed bars). */
  loadHistory(history: readonly Candle[]): void {
    const m1 = [...history].sort((a, b) => a.time - b.time).slice(-this.maxM1);
    this.m1 = m1;
    this.formingM1 = null;
    this.bucketAcc = {};
    const last = m1[m1.length - 1];
    for (const tf of DERIVED_TIMEFRAMES) {
      const all = aggregateCandles(m1, tf);
      if (last && all.length > 0 && !isBucketComplete(last.time, tf)) {
        this.bucketAcc[tf] = all[all.length - 1];
        this.closed[tf] = all.slice(0, -1);
      } else {
        this.closed[tf] = all;
      }
    }
  }

  /** Feeds one M1 update. Returns events for M1 and every derived timeframe. */
  push(candle: Candle, closed: boolean): FeedEvent[] {
    if (!closed) return this.pushForming(candle);
    return this.pushClosed(candle);
  }

  private pushForming(snapshot: Candle): FeedEvent[] {
    this.formingM1 = snapshot;
    const events: FeedEvent[] = [{ tf: 'M1', candle: snapshot, closed: false }];
    for (const tf of DERIVED_TIMEFRAMES) {
      const start = bucketStart(snapshot.time, tf);
      const acc = this.bucketAcc[tf];
      const base = acc && acc.time === start ? acc : undefined;
      events.push({ tf, candle: mergeIntoBucket(base, snapshot, start), closed: false });
    }
    return events;
  }

  private pushClosed(candle: Candle): FeedEvent[] {
    const last = this.m1[this.m1.length - 1];
    if (last && candle.time < last.time) return []; // stale, ignore
    const replacing = last !== undefined && candle.time === last.time;
    this.m1 = replacing ? [...this.m1.slice(0, -1), candle] : [...this.m1, candle];
    this.formingM1 = null;
    this.trim();
    if (replacing) return this.rebuildBuckets(candle);

    const events: FeedEvent[] = [{ tf: 'M1', candle, closed: true }];
    for (const tf of DERIVED_TIMEFRAMES) {
      const start = bucketStart(candle.time, tf);
      const acc = this.bucketAcc[tf];
      if (acc && acc.time !== start) {
        // Bucket changed without seeing its final minute (gap / break): close the old one.
        this.closed[tf] = [...this.closed[tf], acc];
        events.push({ tf, candle: acc, closed: true });
        this.bucketAcc[tf] = undefined;
      }
      const merged = mergeIntoBucket(this.bucketAcc[tf]?.time === start ? this.bucketAcc[tf] : undefined, candle, start);
      if (isBucketComplete(candle.time, tf)) {
        this.closed[tf] = [...this.closed[tf], merged];
        this.bucketAcc[tf] = undefined;
        events.push({ tf, candle: merged, closed: true });
      } else {
        this.bucketAcc[tf] = merged;
        events.push({ tf, candle: merged, closed: false });
      }
    }
    return events;
  }

  /** A re-sent last bar must not be merged twice: recompute every forming bucket from the M1 history. */
  private rebuildBuckets(candle: Candle): FeedEvent[] {
    const events: FeedEvent[] = [{ tf: 'M1', candle, closed: true }];
    for (const tf of DERIVED_TIMEFRAMES) {
      const start = bucketStart(candle.time, tf);
      const inBucket = this.m1.filter((c) => c.time >= start && c.time <= candle.time);
      const merged = aggregateCandles(inBucket, tf)[0];
      if (!merged) continue;
      if (isBucketComplete(candle.time, tf)) {
        this.closed[tf] = [...this.closed[tf].filter((c) => c.time !== start), merged];
        this.bucketAcc[tf] = undefined;
        events.push({ tf, candle: merged, closed: true });
      } else {
        this.bucketAcc[tf] = merged;
        events.push({ tf, candle: merged, closed: false });
      }
    }
    return events;
  }

  private trim(): void {
    const limit = Math.floor(this.maxM1 * (1 + TRIM_SLACK));
    if (this.m1.length > limit) this.m1 = this.m1.slice(-this.maxM1);
    for (const tf of DERIVED_TIMEFRAMES) {
      const cap = Math.ceil(this.maxM1 / (tf === 'M5' ? 5 : tf === 'M15' ? 15 : 30));
      if (this.closed[tf].length > Math.floor(cap * (1 + TRIM_SLACK))) this.closed[tf] = this.closed[tf].slice(-cap);
    }
  }

  /** Closed bars of a timeframe (ascending). */
  closedCandles(tf: Timeframe, limit?: number): Candle[] {
    const arr = tf === 'M1' ? this.m1 : this.closed[tf];
    return limit === undefined ? [...arr] : arr.slice(-limit);
  }

  /** Closed bars plus the forming bar (if any) — what a chart shows. */
  candlesWithForming(tf: Timeframe, limit?: number): Candle[] {
    const forming = this.forming(tf);
    if (!forming) return this.closedCandles(tf, limit);
    const base = this.closedCandles(tf, limit === undefined ? undefined : Math.max(0, limit - 1));
    return [...base, forming];
  }

  forming(tf: Timeframe): Candle | null {
    if (tf === 'M1') return this.formingM1;
    const acc = this.bucketAcc[tf];
    if (!this.formingM1) return acc ?? null;
    const start = bucketStart(this.formingM1.time, tf);
    return mergeIntoBucket(acc && acc.time === start ? acc : undefined, this.formingM1, start);
  }

  lastClosedM1(): Candle | null {
    return this.m1[this.m1.length - 1] ?? null;
  }

  lastPrice(): number | null {
    return this.formingM1?.close ?? this.lastClosedM1()?.close ?? null;
  }

  size(): Record<Timeframe, number> {
    return { M1: this.m1.length, M5: this.closed.M5.length, M15: this.closed.M15.length, M30: this.closed.M30.length };
  }
}

export const ALL_TIMEFRAMES = TIMEFRAMES;
