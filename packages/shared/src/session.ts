import { z } from 'zod';

/** Trading sessions in UTC hours. Displayed in WIB (UTC+7) by the UI. */
export const SESSIONS = ['asia', 'london', 'overlap', 'newyork', 'closed'] as const;
export const SessionSchema = z.enum(SESSIONS);
export type Session = z.infer<typeof SessionSchema>;

/**
 * XAUUSD follows the FX week in New York time: opens Sunday 18:00 ET, closes Friday 17:00 ET,
 * with a daily maintenance break 17:00–18:00 ET. That is 21:00/22:00 UTC in summer and
 * 22:00/23:00 UTC in winter (verified against Dukascopy M1 data).
 */
export const MARKET_TIMEZONE = 'America/New_York';
export const DAILY_BREAK_START_HOUR_NY = 17;
export const DAILY_BREAK_END_HOUR_NY = 18;
const SUNDAY = 0;
const FRIDAY = 5;
const SATURDAY = 6;

export const SESSION_WINDOWS_UTC = {
  asia: { start: 0, end: 7 },
  london: { start: 7, end: 12 },
  overlap: { start: 12, end: 16 },
  newyork: { start: 16, end: 21 },
} as const;

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TIMEZONE,
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const SECONDS_PER_HOUR = 3600;
const CACHE_LIMIT = 50_000;
const hourCache = new Map<number, { weekday: number; hour: number }>();

/** New York weekday + hour for a unix time, memoised per UTC hour (DST shifts happen on hour boundaries). */
export function newYorkWallClock(unixSec: number): { weekday: number; hour: number } {
  const bucket = Math.floor(unixSec / SECONDS_PER_HOUR);
  const cached = hourCache.get(bucket);
  if (cached) return cached;
  const parts = nyFormatter.formatToParts(new Date(bucket * SECONDS_PER_HOUR * 1000));
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const value = { weekday: WEEKDAY_INDEX[weekdayPart] ?? 0, hour: Number(hourPart) % 24 };
  if (hourCache.size >= CACHE_LIMIT) hourCache.clear();
  hourCache.set(bucket, value);
  return value;
}

export function isMarketOpen(unixSec: number): boolean {
  const { weekday, hour } = newYorkWallClock(unixSec);
  if (weekday === SATURDAY) return false;
  if (weekday === SUNDAY) return hour >= DAILY_BREAK_END_HOUR_NY;
  if (weekday === FRIDAY) return hour < DAILY_BREAK_START_HOUR_NY;
  return hour < DAILY_BREAK_START_HOUR_NY || hour >= DAILY_BREAK_END_HOUR_NY;
}

export function sessionAt(unixSec: number): Session {
  if (!isMarketOpen(unixSec)) return 'closed';
  const hourUtc = Math.floor((unixSec % 86_400) / SECONDS_PER_HOUR);
  if (hourUtc < SESSION_WINDOWS_UTC.asia.end) return 'asia';
  if (hourUtc < SESSION_WINDOWS_UTC.london.end) return 'london';
  if (hourUtc < SESSION_WINDOWS_UTC.overlap.end) return 'overlap';
  if (hourUtc < SESSION_WINDOWS_UTC.newyork.end) return 'newyork';
  // Late NY hours after 21:00 UTC (winter) before the daily break.
  return 'newyork';
}

export const SESSION_LABEL_ID: Record<Session, string> = {
  asia: 'Asia',
  london: 'London',
  overlap: 'London/NY',
  newyork: 'New York',
  closed: 'Tutup',
};
