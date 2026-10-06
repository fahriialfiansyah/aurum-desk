import {
  PLAYBOOKS,
  RR_TP1,
  RR_TP2,
  TIMEFRAME_SECONDS,
  formatPrice,
  isoFromSec,
  secFromIso,
  type Bias,
  type Direction,
  type PlaybookId,
  type Setup,
  type SetupStatus,
  type Zone,
} from '@aurum/shared';
import type { LifecycleParams } from '../params';
import type { PressureResult } from '../pressure/evaluate';
import type { Levels } from '../risk/levels';

export const TREND_LABEL_ID: Record<Bias['trend'], string> = { bullish: 'bullish', bearish: 'bearish', ranging: 'ranging' };

export function setupId(playbook: PlaybookId, zoneId: string): string {
  return `stp-${playbook}-${zoneId}`;
}

export type BuildSetupInput = {
  playbook: PlaybookId;
  direction: Direction;
  bias: Bias;
  zone: Zone;
  /** Higher-timeframe zone the entry zone was refined from, if any. */
  parentZone: Zone | null;
  levels: Levels;
  pressure: PressureResult;
  nowSec: number;
  minPressureScore: number;
  lifecycle: LifecycleParams;
};

export function biasLine(bias: Bias): string {
  const event = bias.lastEvent ? `${bias.lastEvent} terakhir @ ${formatPrice(bias.eventPrice)}` : 'belum ada BOS/CHoCH';
  return `Bias ${bias.tf} ${TREND_LABEL_ID[bias.trend]} — ${event}`;
}

export function zoneLine(zone: Zone): string {
  const state = zone.invalidated ? 'invalid' : zone.fresh ? 'fresh' : 'tested';
  return `Zona ${zone.type} ${zone.tf} ${formatPrice(zone.bottom)}–${formatPrice(zone.top)} (${zone.pattern}, skor ${zone.score}, ${state})`;
}

export function levelsLine(levels: Levels): string {
  return (
    `Entry ${formatPrice(levels.entry)} · SL ${formatPrice(levels.stopLoss)} (buffer ${formatPrice(levels.buffer)}) · ` +
    `TP1 ${formatPrice(levels.tp1)} (1:${RR_TP1}) · TP2 ${formatPrice(levels.tp2)} (1:${RR_TP2}) · risiko ${formatPrice(levels.riskPts)} pt`
  );
}

export function pressureLine(pressure: PressureResult): string {
  if (!pressure.touched) return 'Menunggu harga masuk zona';
  const patterns = pressure.patterns.length > 0 ? pressure.patterns.join(', ') : 'belum ada pola konfirmasi';
  return `Pressure ${pressure.score}/100: ${patterns}`;
}

/** Pure constructor for a fresh setup object (no identity carry-over; see reconcileSetups). */
export function buildSetup(input: BuildSetupInput): Setup {
  const { playbook, direction, bias, zone, parentZone, levels, pressure, nowSec, lifecycle } = input;
  const entryTf = PLAYBOOKS[playbook].entryTf;
  const tfSec = TIMEFRAME_SECONDS[entryTf];
  const isValid = pressure.touched && pressure.score >= input.minPressureScore;
  const status: SetupStatus = isValid ? 'valid' : 'watching';
  const createdAt = isoFromSec(nowSec);
  const baseExpiry = nowSec + lifecycle.expiryCandles * tfSec;
  const validExpiry = nowSec + lifecycle.validExpiryCandles * tfSec;
  const expiresAt = isoFromSec(isValid ? Math.max(baseExpiry, validExpiry) : baseExpiry);
  const deterministic = [biasLine(bias), zoneLine(zone)];
  if (parentZone) deterministic.push(`Diperhalus dari zona ${parentZone.tf} ${formatPrice(parentZone.bottom)}–${formatPrice(parentZone.top)}`);
  deterministic.push(levelsLine(levels), pressureLine(pressure));
  return {
    id: setupId(playbook, zone.id),
    symbol: 'XAUUSD',
    playbook,
    direction,
    status,
    bias,
    zone: {
      id: zone.id,
      tf: zone.tf,
      type: zone.type,
      top: zone.top,
      bottom: zone.bottom,
      score: zone.score,
      fresh: zone.fresh,
      pattern: zone.pattern,
    },
    entry: levels.entry,
    stopLoss: levels.stopLoss,
    tp1: levels.tp1,
    tp2: levels.tp2,
    riskPts: levels.riskPts,
    rr: { tp1: RR_TP1, tp2: RR_TP2 },
    pressure: pressure.touched ? { score: pressure.score, patterns: [...pressure.patterns] } : null,
    rationale: { deterministic },
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  };
}

const STATUS_RANK: Record<SetupStatus, number> = {
  watching: 0,
  valid: 1,
  triggered: 2,
  tp1: 3,
  tp2: 4,
  stopped: 4,
  invalidated: 4,
  expired: 4,
};

/**
 * Merges a freshly built candidate onto an existing active setup with the same id:
 * identity and progress are kept (never downgrade), analysis fields are refreshed.
 */
export function mergeSetup(existing: Setup, candidate: Setup): Setup {
  const keepExisting = STATUS_RANK[existing.status] >= STATUS_RANK[candidate.status];
  const status = keepExisting ? existing.status : candidate.status;
  const expiresAt = isoFromSec(Math.max(secFromIso(existing.expiresAt), secFromIso(candidate.expiresAt)));
  const progressed = STATUS_RANK[existing.status] >= STATUS_RANK.triggered;
  return {
    ...existing,
    status,
    bias: candidate.bias,
    zone: progressed ? existing.zone : candidate.zone,
    pressure: candidate.pressure ?? existing.pressure,
    rationale: { ...existing.rationale, deterministic: candidate.rationale.deterministic },
    updatedAt: candidate.updatedAt,
    expiresAt: progressed ? existing.expiresAt : expiresAt,
  };
}
