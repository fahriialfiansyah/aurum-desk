import { z } from 'zod';
import { TimeframeSchema } from './timeframe';

export const ZoneTypeSchema = z.enum(['supply', 'demand']);
export type ZoneType = z.infer<typeof ZoneTypeSchema>;

export const ZonePatternSchema = z.enum(['RBR', 'DBD', 'RBD', 'DBR']);
export type ZonePattern = z.infer<typeof ZonePatternSchema>;

export const ZoneScoreBreakdownSchema = z.object({
  departure: z.number().min(0).max(100),
  freshness: z.number().min(0).max(100),
  structure: z.number().min(0).max(100),
  age: z.number().min(0).max(100),
});
export type ZoneScoreBreakdown = z.infer<typeof ZoneScoreBreakdownSchema>;

export const ZoneSchema = z
  .object({
    id: z.string().min(1),
    tf: TimeframeSchema,
    type: ZoneTypeSchema,
    pattern: ZonePatternSchema,
    top: z.number().finite(),
    bottom: z.number().finite(),
    /** Candle indexes (in the series the zone was detected on). */
    baseStart: z.number().int().nonnegative(),
    baseEnd: z.number().int().nonnegative(),
    departureEnd: z.number().int().nonnegative(),
    /** Unix seconds of the first base candle. */
    createdAt: z.number().int().nonnegative(),
    fresh: z.boolean(),
    tested: z.boolean(),
    invalidated: z.boolean(),
    score: z.number().min(0).max(100),
    scoreBreakdown: ZoneScoreBreakdownSchema,
  })
  .refine((zn) => zn.top >= zn.bottom, { message: 'zone top must be >= bottom', path: ['top'] });
export type Zone = z.infer<typeof ZoneSchema>;

/** Price at which a trade would enter: the edge of the zone closest to current price. */
export function zoneProximalEdge(zone: Pick<Zone, 'type' | 'top' | 'bottom'>): number {
  return zone.type === 'demand' ? zone.top : zone.bottom;
}

/** The far edge: stop-loss side. */
export function zoneDistalEdge(zone: Pick<Zone, 'type' | 'top' | 'bottom'>): number {
  return zone.type === 'demand' ? zone.bottom : zone.top;
}

export function isPriceInsideZone(price: number, zone: Pick<Zone, 'top' | 'bottom'>): boolean {
  return price <= zone.top && price >= zone.bottom;
}
