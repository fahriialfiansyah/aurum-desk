import { z } from 'zod';

export const TrendSchema = z.enum(['bullish', 'bearish', 'ranging']);
export type TrendState = z.infer<typeof TrendSchema>;

export const DirectionSchema = z.enum(['long', 'short']);
export type Direction = z.infer<typeof DirectionSchema>;

export const StructureEventKindSchema = z.enum(['BOS', 'CHoCH']);
export type StructureEventKind = z.infer<typeof StructureEventKindSchema>;

export const SwingKindSchema = z.enum(['high', 'low']);
export const SwingLabelSchema = z.enum(['HH', 'HL', 'LH', 'LL']);
export type SwingLabel = z.infer<typeof SwingLabelSchema>;

export const SwingPointSchema = z.object({
  index: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  price: z.number().finite(),
  kind: SwingKindSchema,
});
export type SwingPoint = z.infer<typeof SwingPointSchema>;

export const LabeledSwingSchema = SwingPointSchema.extend({ label: SwingLabelSchema.nullable() });
export type LabeledSwing = z.infer<typeof LabeledSwingSchema>;

export const StructureEventSchema = z.object({
  kind: StructureEventKindSchema,
  direction: TrendSchema.exclude(['ranging']),
  index: z.number().int().nonnegative(),
  time: z.number().int().nonnegative(),
  price: z.number().finite(),
  brokenSwing: SwingPointSchema,
});
export type StructureEvent = z.infer<typeof StructureEventSchema>;

export const MarketStructureSchema = z.object({
  trend: TrendSchema,
  swings: z.array(LabeledSwingSchema),
  events: z.array(StructureEventSchema),
  lastEvent: StructureEventSchema.nullable(),
});
export type MarketStructure = z.infer<typeof MarketStructureSchema>;
