import type { Candle } from '@aurum/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ReplayProvider, formingSteps } from '../src/providers/replay';

const T0 = Date.UTC(2025, 8, 2, 10, 0) / 1000;
const history: Candle[] = Array.from({ length: 10 }, (_, i) => ({
  time: T0 + i * 60,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: 4,
}));

describe('formingSteps', () => {
  test('walks open → low → high → close for a bullish bar and ends on the real bar', () => {
    const bar = history[0]!;
    const steps = formingSteps(bar);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({ open: 100, high: 100, low: 100, close: 100 });
    expect(steps[1]?.close).toBe(99);
    expect(steps[2]?.close).toBe(101);
    expect(steps[3]).toEqual(bar);
    for (const s of steps) {
      expect(s.low).toBeLessThanOrEqual(Math.min(s.open, s.close));
      expect(s.high).toBeGreaterThanOrEqual(Math.max(s.open, s.close));
    }
  });
});

describe('ReplayProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('splits warmup from the stream and emits closed bars in order at high speed', async () => {
    const provider = new ReplayProvider({ candles: history, speed: 600, warmupBars: 4, source: 'csv:test' });
    expect(await provider.warmup(100)).toEqual(history.slice(0, 4));
    const got: Array<[number, boolean]> = [];
    await provider.start((c, m) => got.push([c.time, m.closed]));
    await vi.advanceTimersByTimeAsync(100 * 6); // 6 bars at 100 ms each
    expect(got.map(([t]) => t)).toEqual(history.slice(4).map((c) => c.time));
    expect(got.every(([, closed]) => closed)).toBe(true);
    expect(provider.status().connected).toBe(false); // finished
    expect(provider.status().replay?.position).toBe(6);
  });

  test('emits forming snapshots before the closed bar at low speed', async () => {
    const provider = new ReplayProvider({ candles: history, speed: 60, warmupBars: 9, source: 'csv:test' });
    const got: Array<{ closed: boolean; close: number }> = [];
    await provider.start((c, m) => got.push({ closed: m.closed, close: c.close }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(got.map((g) => g.closed)).toEqual([false, false, false, true]);
    expect(got[3]?.close).toBe(history[9]!.close);
  });

  test('pause/play/setSpeed/restart control the transport', async () => {
    const provider = new ReplayProvider({ candles: history, speed: 600, warmupBars: 5, source: 'csv:test' });
    const got: number[] = [];
    await provider.start((c) => got.push(c.time));
    await vi.advanceTimersByTimeAsync(250); // 3 bars
    provider.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toHaveLength(3);
    expect(provider.status().replay?.playing).toBe(false);
    provider.setSpeed(6000);
    provider.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(got).toHaveLength(5);
    await provider.restart();
    await vi.advanceTimersByTimeAsync(100);
    expect(got.slice(5, 7)).toEqual([history[5]!.time, history[6]!.time]);
    expect(() => provider.setSpeed(0)).toThrow(RangeError);
    await provider.stop();
  });

  test('startTime selects the replay cursor', async () => {
    const provider = new ReplayProvider({ candles: history, speed: 600, warmupBars: 3, startTime: history[7]!.time, source: 's' });
    expect(await provider.warmup(2)).toEqual(history.slice(5, 7));
    expect(provider.status().replay?.startTime).toBe(history[7]!.time);
  });

  test('rejects empty data and non-positive speed', () => {
    expect(() => new ReplayProvider({ candles: [], speed: 1, warmupBars: 0, source: 's' })).toThrow();
    expect(() => new ReplayProvider({ candles: history, speed: 0, warmupBars: 0, source: 's' })).toThrow(RangeError);
  });
});
