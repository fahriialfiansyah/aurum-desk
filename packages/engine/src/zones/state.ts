import type { Candle, Zone } from '@aurum/shared';
import type { ZoneCandidate } from './detect';

export type ZoneState = Pick<Zone, 'fresh' | 'tested' | 'invalidated' | 'touches'>;

function intersects(c: Candle, zone: { top: number; bottom: number }): boolean {
  return c.low <= zone.top && c.high >= zone.bottom;
}

function closesThrough(c: Candle, zone: { type: Zone['type']; top: number; bottom: number }): boolean {
  return zone.type === 'demand' ? c.close < zone.bottom : c.close > zone.top;
}

/**
 * Replays candles after the departure: counts distinct visits, detects a body close through the
 * distal edge (invalidation). A zone being visited for the first time right now is still fresh.
 */
export function computeZoneState(zone: ZoneCandidate | Zone, candles: readonly Candle[]): ZoneState {
  let touches = 0;
  let wasInside = false;
  let invalidated = false;
  let insideNow = false;
  for (let i = zone.departureEnd + 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const inside = intersects(c, zone);
    if (inside && !wasInside) touches += 1;
    wasInside = inside;
    insideNow = inside;
    if (closesThrough(c, zone)) {
      invalidated = true;
      break;
    }
  }
  const tested = touches > 1 || (touches === 1 && !insideNow);
  return { touches, invalidated, tested, fresh: !invalidated && !tested };
}

/** Re-evaluates states for existing zones against a (longer) candle series. Returns new objects. */
export function updateZoneStates<T extends ZoneCandidate | Zone>(zones: readonly T[], candles: readonly Candle[]): Array<T & ZoneState> {
  return zones.map((z) => ({ ...z, ...computeZoneState(z, candles) }));
}
