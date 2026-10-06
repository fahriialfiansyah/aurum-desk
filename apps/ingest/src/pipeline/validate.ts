import { atr } from '@aurum/engine';
import { m1CandleSchema, type Candle } from '@aurum/shared';

export const JUMP_ATR_MULTIPLE = 5;
export const JUMP_ATR_PERIOD = 14;
/** How many previously-stored candles to prepend for ATR context when checking jumps. */
export const JUMP_CONTEXT_BARS = 50;

export type RejectedBar = { raw: unknown; reason: string };
export type AnomalyRecord = { tsSec: number; kind: 'price_jump' | 'duplicate'; detail: Record<string, unknown> };

export type ValidationResult = {
  candles: Candle[];
  rejected: RejectedBar[];
  anomalies: AnomalyRecord[];
};

export type ValidationContext = {
  nowSec: number;
  /** Ascending candles that precede `raw` chronologically (for ATR context). */
  previous?: readonly Candle[];
};

function issueMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const first = error.issues[0];
  if (!first) return 'invalid';
  const path = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  return `${path}${first.message}`;
}

/** Sorts ascending and keeps the LAST occurrence of duplicate timestamps. */
function sortAndDedupe(candles: readonly Candle[]): { candles: Candle[]; duplicates: AnomalyRecord[] } {
  const byTime = new Map<number, Candle>();
  const duplicates: AnomalyRecord[] = [];
  for (const c of candles) {
    if (byTime.has(c.time)) duplicates.push({ tsSec: c.time, kind: 'duplicate', detail: { time: c.time } });
    byTime.set(c.time, c);
  }
  return { candles: [...byTime.values()].sort((a, b) => a.time - b.time), duplicates };
}

/** Flags |close − prevClose| > JUMP_ATR_MULTIPLE × ATR(14). Flagged bars are kept, not dropped. */
export function detectPriceJumps(candles: readonly Candle[], previous: readonly Candle[] = []): AnomalyRecord[] {
  const context = previous.slice(-JUMP_CONTEXT_BARS);
  const series = [...context, ...candles];
  const atrValues = atr(series, JUMP_ATR_PERIOD);
  const anomalies: AnomalyRecord[] = [];
  for (let i = Math.max(context.length, 1); i < series.length; i += 1) {
    const current = series[i];
    const prev = series[i - 1];
    const atrPrev = atrValues[i - 1];
    if (!current || !prev || atrPrev === undefined || Number.isNaN(atrPrev) || atrPrev <= 0) continue;
    const jump = Math.abs(current.close - prev.close);
    if (jump > JUMP_ATR_MULTIPLE * atrPrev) {
      anomalies.push({
        tsSec: current.time,
        kind: 'price_jump',
        detail: { prevClose: prev.close, close: current.close, jump, atr: atrPrev, multiple: jump / atrPrev },
      });
    }
  }
  return anomalies;
}

/** Zod validation at the adapter boundary + duplicate handling + jump flagging. Pure. */
export function validateCandles(raw: readonly unknown[], ctx: ValidationContext): ValidationResult {
  const schema = m1CandleSchema(ctx.nowSec);
  const accepted: Candle[] = [];
  const rejected: RejectedBar[] = [];
  for (const item of raw) {
    const parsed = schema.safeParse(item);
    if (parsed.success) accepted.push(parsed.data);
    else rejected.push({ raw: item, reason: issueMessage(parsed.error) });
  }
  const { candles, duplicates } = sortAndDedupe(accepted);
  const jumps = detectPriceJumps(candles, ctx.previous ?? []);
  return { candles, rejected, anomalies: [...duplicates, ...jumps] };
}
