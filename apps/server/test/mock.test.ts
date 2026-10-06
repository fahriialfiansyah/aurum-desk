import { CandleSchema } from '@aurum/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MockProvider } from '../src/providers/mock';

describe('MockProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('is loudly flagged as mock', () => {
    const p = new MockProvider({ seed: 1 });
    expect(p.isMock).toBe(true);
    expect(p.status().message).toMatch(/MOCK DATA/);
  });

  test('warmup + stream produce valid, minute-aligned, contiguous candles', async () => {
    const start = Date.UTC(2025, 8, 2, 10, 0) / 1000;
    const p = new MockProvider({ seed: 7, intervalMs: 10, startTime: start });
    const warm = await p.warmup(5);
    expect(warm.map((c) => c.time)).toEqual([start - 300, start - 240, start - 180, start - 120, start - 60]);
    const live: number[] = [];
    await p.start((c) => {
      CandleSchema.parse(c);
      live.push(c.time);
    });
    await vi.advanceTimersByTimeAsync(35);
    expect(live).toEqual([start, start + 60, start + 120]);
    await p.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(live).toHaveLength(3);
    expect(p.status().connected).toBe(false);
  });

  test('is deterministic for a given seed', async () => {
    const a = await new MockProvider({ seed: 3, startTime: 0 }).warmup(3);
    const b = await new MockProvider({ seed: 3, startTime: 0 }).warmup(3);
    expect(a).toEqual(b);
  });
});
