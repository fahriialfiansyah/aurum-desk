import { TIMEFRAME_SECONDS, isMarketOpen } from '@aurum/shared';

const MINUTE = TIMEFRAME_SECONDS.M1;
export const DEFAULT_MIN_GAP_MINUTES = 5;

/** Inclusive range of missing minute opens. */
export type GapRange = { fromSec: number; toSec: number; minutes: number };

/** Minute opens in [fromSec, toSec) during which the market is open. */
export function* expectedMinutes(fromSec: number, toSec: number): Generator<number> {
  const start = Math.ceil(fromSec / MINUTE) * MINUTE;
  for (let t = start; t < toSec; t += MINUTE) {
    if (isMarketOpen(t)) yield t;
  }
}

export function expectedMinuteCount(fromSec: number, toSec: number): number {
  let n = 0;
  for (const _ of expectedMinutes(fromSec, toSec)) n += 1;
  return n;
}

/**
 * Lists missing market-hours minutes in [fromSec, toSec) as contiguous ranges, ignoring runs shorter
 * than `minGapMinutes` (flat minutes without ticks are legitimately absent from the provider).
 */
export function findGaps(
  fromSec: number,
  toSec: number,
  present: ReadonlySet<number>,
  options: { minGapMinutes?: number } = {},
): GapRange[] {
  const minGap = options.minGapMinutes ?? DEFAULT_MIN_GAP_MINUTES;
  const gaps: GapRange[] = [];
  let runStart: number | null = null;
  let runEnd = 0;

  const flush = () => {
    if (runStart === null) return;
    const minutes = (runEnd - runStart) / MINUTE + 1;
    if (minutes >= minGap) gaps.push({ fromSec: runStart, toSec: runEnd, minutes });
    runStart = null;
  };

  for (const t of expectedMinutes(fromSec, toSec)) {
    if (present.has(t)) {
      flush();
      continue;
    }
    if (runStart !== null && t === runEnd + MINUTE) {
      runEnd = t;
      continue;
    }
    flush();
    runStart = t;
    runEnd = t;
  }
  flush();
  return gaps;
}
