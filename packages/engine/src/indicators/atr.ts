import type { Candle } from '@aurum/shared';

export const DEFAULT_ATR_PERIOD = 14;

export function trueRange(current: Candle, previous: Candle | undefined): number {
  const highLow = current.high - current.low;
  if (!previous) return highLow;
  return Math.max(highLow, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close));
}

/**
 * Wilder's Average True Range. Returns one value per candle; entries before the first full
 * period are NaN so callers cannot accidentally use a half-warmed value.
 */
export function atr(candles: readonly Candle[], period: number = DEFAULT_ATR_PERIOD): number[] {
  if (period < 1) throw new RangeError(`atr: period must be >= 1, got ${period}`);
  const out: number[] = new Array<number>(candles.length).fill(Number.NaN);
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const current = candles[i];
    if (!current) continue;
    const tr = trueRange(current, candles[i - 1]);
    if (i < period) {
      sum += tr;
      if (i === period - 1) out[i] = sum / period;
      continue;
    }
    const prev = out[i - 1] ?? Number.NaN;
    out[i] = (prev * (period - 1) + tr) / period;
  }
  return out;
}

/** Latest fully-formed ATR value, or null when there is not enough history. */
export function lastAtr(candles: readonly Candle[], period: number = DEFAULT_ATR_PERIOD): number | null {
  const values = atr(candles, period);
  const last = values[values.length - 1];
  return last === undefined || Number.isNaN(last) ? null : last;
}
