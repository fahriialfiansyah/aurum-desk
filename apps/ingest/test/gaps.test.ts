import { describe, expect, test } from 'vitest';
import { expectedMinuteCount, findGaps } from '../src/pipeline/gaps';

const utc = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;

describe('expectedMinuteCount', () => {
  test('counts only market-open minutes (skips weekend and daily break)', () => {
    // Friday 2025-09-05 20:00 UTC → Monday 2025-09-08 00:00 UTC: open 20:00–21:00 Fri, closed until Sun 22:00, open Sun 22:00–Mon 00:00
    expect(expectedMinuteCount(utc(2025, 9, 5, 20), utc(2025, 9, 8, 0))).toBe(60 + 120);
    // One full Tuesday in summer: 24h minus the 21:00–22:00 UTC break
    expect(expectedMinuteCount(utc(2025, 9, 2, 0), utc(2025, 9, 3, 0))).toBe(23 * 60);
  });
});

describe('findGaps', () => {
  const from = utc(2025, 9, 2, 10);
  const to = utc(2025, 9, 2, 12);
  const allMinutes = Array.from({ length: 120 }, (_, i) => from + i * 60);

  test('no gaps when every minute is present', () => {
    expect(findGaps(from, to, new Set(allMinutes))).toEqual([]);
  });

  test('detects a contiguous missing range', () => {
    const present = new Set(allMinutes.filter((t) => t < from + 30 * 60 || t >= from + 45 * 60));
    expect(findGaps(from, to, present)).toEqual([{ fromSec: from + 30 * 60, toSec: from + 44 * 60, minutes: 15 }]);
  });

  test('ignores runs shorter than minGapMinutes (flat minutes)', () => {
    const present = new Set(allMinutes.filter((t) => t !== from + 10 * 60 && t !== from + 11 * 60));
    expect(findGaps(from, to, present, { minGapMinutes: 5 })).toEqual([]);
    expect(findGaps(from, to, present, { minGapMinutes: 1 })).toEqual([{ fromSec: from + 10 * 60, toSec: from + 11 * 60, minutes: 2 }]);
  });

  test('weekend is not a gap, but missing Sunday-night bars are', () => {
    const wFrom = utc(2025, 9, 5, 20);
    const wTo = utc(2025, 9, 8, 0);
    const fridayOnly = new Set(Array.from({ length: 60 }, (_, i) => wFrom + i * 60));
    const gaps = findGaps(wFrom, wTo, fridayOnly);
    expect(gaps).toEqual([{ fromSec: utc(2025, 9, 7, 22), toSec: utc(2025, 9, 7, 23, 59), minutes: 120 }]);
  });
});
