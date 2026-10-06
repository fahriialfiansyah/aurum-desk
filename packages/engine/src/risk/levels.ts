import { roundPrice, zoneDistalEdge, zoneProximalEdge, type Direction, type Zone } from '@aurum/shared';
import type { RiskParams } from '../params';

export type Levels = { entry: number; stopLoss: number; tp1: number; tp2: number; riskPts: number; buffer: number };

export type ZoneLevelsInput = Pick<Zone, 'type' | 'top' | 'bottom'>;

/**
 * Entry at the proximal edge, SL beyond the distal edge + buffer (max(0.1×ATR, 0.30)),
 * TP1 = 1.5R, TP2 = 2R. Every level rounded to 0.01.
 */
export function computeLevels(args: { direction: Direction; zone: ZoneLevelsInput; atr: number }, params: RiskParams): Levels {
  const { direction, zone, atr } = args;
  if (!Number.isFinite(atr) || atr <= 0) throw new RangeError('computeLevels: atr must be a positive finite number');
  const expected = zone.type === 'demand' ? 'long' : 'short';
  if (expected !== direction) throw new RangeError(`computeLevels: ${zone.type} zone cannot host a ${direction} setup`);
  const buffer = roundPrice(Math.max(params.slBufferAtr * atr, params.slBufferMin));
  const entry = roundPrice(zoneProximalEdge(zone));
  const distal = zoneDistalEdge(zone);
  const stopLoss = roundPrice(direction === 'long' ? distal - buffer : distal + buffer);
  const riskPts = roundPrice(Math.abs(entry - stopLoss));
  if (riskPts <= 0) throw new RangeError('computeLevels: zero risk distance');
  const sign = direction === 'long' ? 1 : -1;
  return {
    entry,
    stopLoss,
    tp1: roundPrice(entry + sign * params.rrTp1 * riskPts),
    tp2: roundPrice(entry + sign * params.rrTp2 * riskPts),
    riskPts,
    buffer,
  };
}

/** R multiple of a price relative to entry/risk (positive = in profit). */
export function rMultiple(direction: Direction, entry: number, riskPts: number, price: number): number {
  const move = direction === 'long' ? price - entry : entry - price;
  return move / riskPts;
}

export type PositionSize = { lots: number; riskAmount: number; valuePerPointPerLot: number };

const LOT_STEP = 0.01;

/** XAUUSD: 1 lot = 100 oz, so a $1 move = $100 per lot. Lots are floored to 0.01. */
export function positionSize(
  args: { accountSize: number; riskPercent: number; riskPts: number },
  params: RiskParams,
): PositionSize {
  const riskAmount = (args.accountSize * args.riskPercent) / 100;
  const valuePerPointPerLot = params.contractSize;
  const rawLots = riskAmount / (args.riskPts * valuePerPointPerLot);
  const lots = Math.floor(rawLots / LOT_STEP) * LOT_STEP;
  return { lots: Number(lots.toFixed(2)), riskAmount: Number(riskAmount.toFixed(2)), valuePerPointPerLot };
}
