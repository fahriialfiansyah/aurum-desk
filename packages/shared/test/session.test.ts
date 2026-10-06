import { describe, expect, test } from 'vitest';
import { isMarketOpen, newYorkWallClock, sessionAt } from '../src/session';

const utc = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;

describe('market calendar (XAUUSD, New York based)', () => {
  test('summer (EDT): closes Fri 21:00 UTC, opens Sun 22:00 UTC, daily break 21:00–22:00 UTC', () => {
    expect(isMarketOpen(utc(2025, 9, 5, 20, 59))).toBe(true);
    expect(isMarketOpen(utc(2025, 9, 5, 21))).toBe(false);
    expect(isMarketOpen(utc(2025, 9, 6, 12))).toBe(false); // Saturday
    expect(isMarketOpen(utc(2025, 9, 7, 21, 59))).toBe(false);
    expect(isMarketOpen(utc(2025, 9, 7, 22))).toBe(true);
    expect(isMarketOpen(utc(2025, 9, 2, 21, 30))).toBe(false); // Tuesday daily break
    expect(isMarketOpen(utc(2025, 9, 2, 22))).toBe(true);
  });

  test('winter (EST): closes Fri 22:00 UTC, opens Sun 23:00 UTC, daily break 22:00–23:00 UTC', () => {
    expect(isMarketOpen(utc(2025, 1, 17, 21, 59))).toBe(true);
    expect(isMarketOpen(utc(2025, 1, 17, 22))).toBe(false);
    expect(isMarketOpen(utc(2025, 1, 19, 22, 59))).toBe(false);
    expect(isMarketOpen(utc(2025, 1, 19, 23))).toBe(true);
    expect(isMarketOpen(utc(2025, 1, 14, 22, 30))).toBe(false);
    expect(isMarketOpen(utc(2025, 1, 14, 23))).toBe(true);
    expect(isMarketOpen(utc(2025, 1, 14, 21, 30))).toBe(true);
  });

  test('open mid-week', () => {
    expect(isMarketOpen(utc(2025, 9, 3, 3))).toBe(true);
  });

  test('newYorkWallClock maps UTC to ET', () => {
    expect(newYorkWallClock(utc(2025, 9, 3, 3))).toEqual({ weekday: 2, hour: 23 }); // Tue 23:00 EDT
    expect(newYorkWallClock(utc(2025, 1, 15, 3))).toEqual({ weekday: 2, hour: 22 }); // Tue 22:00 EST
  });
});

describe('sessionAt', () => {
  test('maps UTC hours to sessions', () => {
    expect(sessionAt(utc(2025, 9, 3, 2))).toBe('asia');
    expect(sessionAt(utc(2025, 9, 3, 8))).toBe('london');
    expect(sessionAt(utc(2025, 9, 3, 13))).toBe('overlap');
    expect(sessionAt(utc(2025, 9, 3, 18))).toBe('newyork');
    expect(sessionAt(utc(2025, 1, 14, 21, 30))).toBe('newyork');
  });
  test('closed on weekend and during the daily break', () => {
    expect(sessionAt(utc(2025, 9, 6, 12))).toBe('closed');
    expect(sessionAt(utc(2025, 9, 2, 21, 30))).toBe('closed');
  });
});
