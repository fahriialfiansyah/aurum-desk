import type { Candle } from '@aurum/shared';
import { TwelveDataError } from '@aurum/shared/node';
import { describe, expect, test, vi } from 'vitest';
import { TwelveDataLiveProvider } from '../src/providers/twelvedata';

const T0 = Date.UTC(2026, 9, 6, 10, 0) / 1000;
const bar = (t: number, c = 4600): Candle => ({ time: t, open: c, high: c + 1, low: c - 1, close: c + 0.5, volume: 0 });

/** Manual clock + timer queue so polls run deterministically. */
function fakeClock(startMs: number) {
  let now = startMs;
  const timers: Array<{ at: number; fn: () => void }> = [];
  return {
    clock: {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (h: unknown) => {
        const i = timers.indexOf(h as { at: number; fn: () => void });
        if (i >= 0) timers.splice(i, 1);
      },
    },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        now = next.at;
        next.fn();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      }
      now = until;
    },
  };
}

describe('TwelveDataLiveProvider', () => {
  test('warmup returns closed bars; polling emits new closed bars once and the forming bar as closed:false', async () => {
    const { clock, advance } = fakeClock((T0 + 125) * 1000); // 10:02:05 → bars 10:00 and 10:01 are closed, 10:02 forming
    const timeSeries = vi.fn(async (args: { includeForming?: boolean }) => {
      const all = [bar(T0), bar(T0 + 60), bar(T0 + 120)];
      return args.includeForming ? all : all.slice(0, 2);
    });
    const p = new TwelveDataLiveProvider({ client: { timeSeries } as never, pollMs: 15_000, clock });
    const warm = await p.warmup(100);
    expect(warm.map((c) => c.time)).toEqual([T0, T0 + 60]);
    const got: Array<[number, boolean]> = [];
    await p.start((c, m) => got.push([c.time, m.closed]));
    await advance(1);
    expect(got).toEqual([[T0 + 120, false]]);
    // next poll: still inside 10:02 → nothing new but the forming snapshot again
    await advance(15_000);
    expect(got).toHaveLength(2);
    // a minute later the 10:02 bar closed and 10:03 is forming
    timeSeries.mockImplementation(async (args: { includeForming?: boolean }) => {
      const all = [bar(T0 + 60), bar(T0 + 120), bar(T0 + 180)];
      return args.includeForming ? all : all.slice(0, 2);
    });
    await advance(60_000);
    const closed = got.filter(([, c]) => c).map(([t]) => t);
    expect(closed).toEqual([T0 + 120]);
    expect(p.status()).toMatchObject({ provider: 'twelvedata', isMock: false, connected: true, lastCandleTime: T0 + 120 });
    await p.stop();
    expect(p.status().connected).toBe(false);
  });

  test('rate limit backs off a full minute and repeated failures mark the feed disconnected', async () => {
    const { clock, advance } = fakeClock((T0 + 125) * 1000);
    const timeSeries = vi.fn(async () => {
      throw new TwelveDataError(429, 'out of credits');
    });
    const p = new TwelveDataLiveProvider({ client: { timeSeries } as never, pollMs: 1000, clock });
    await p.start(() => undefined);
    await advance(1);
    expect(timeSeries).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(timeSeries).toHaveBeenCalledTimes(1); // still backing off
    await advance(31_000);
    expect(timeSeries).toHaveBeenCalledTimes(2);
    await advance(61_000 * 3);
    expect(p.status().connected).toBe(false);
    expect(p.status().message).toMatch(/429/);
    await p.stop();
  });
});
