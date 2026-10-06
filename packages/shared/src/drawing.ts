import { z } from 'zod';
import { TimeframeSchema } from './timeframe';

/** Chart annotations the copilot can add/remove through tool calls. */
export const DrawingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hline'),
    id: z.string().min(1),
    tf: TimeframeSchema.optional(),
    price: z.number().finite(),
    label: z.string().max(60).optional(),
    color: z.string().optional(),
    style: z.enum(['solid', 'dashed', 'dotted']).default('dashed'),
  }),
  z.object({
    kind: z.literal('box'),
    id: z.string().min(1),
    tf: TimeframeSchema.optional(),
    top: z.number().finite(),
    bottom: z.number().finite(),
    fromTime: z.number().int().nonnegative(),
    toTime: z.number().int().nonnegative().nullable(),
    label: z.string().max(60).optional(),
    color: z.string().optional(),
  }),
  z.object({
    kind: z.literal('marker'),
    id: z.string().min(1),
    tf: TimeframeSchema.optional(),
    time: z.number().int().nonnegative(),
    position: z.enum(['above', 'below']),
    text: z.string().max(30),
    color: z.string().optional(),
  }),
]);
export type Drawing = z.infer<typeof DrawingSchema>;
