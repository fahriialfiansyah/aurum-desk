import { z } from 'zod';
import { DirectionSchema, StructureEventKindSchema, TrendSchema } from './structure';
import { TimeframeSchema } from './timeframe';
import { ZonePatternSchema, ZoneTypeSchema } from './zone';

export const PLAYBOOK_IDS = ['intraday_m30_m15', 'scalp_m15_m5'] as const;
export const PlaybookIdSchema = z.enum(PLAYBOOK_IDS);
export type PlaybookId = z.infer<typeof PlaybookIdSchema>;

export const PLAYBOOKS: Record<PlaybookId, { label: string; shortLabel: 'A' | 'B'; biasTf: 'M30' | 'M15'; entryTf: 'M15' | 'M5' }> = {
  intraday_m30_m15: { label: 'Intraday M30 → M15', shortLabel: 'A', biasTf: 'M30', entryTf: 'M15' },
  scalp_m15_m5: { label: 'Scalping M15 → M5', shortLabel: 'B', biasTf: 'M15', entryTf: 'M5' },
};

export const SETUP_STATUSES = [
  'watching',
  'valid',
  'triggered',
  'tp1',
  'tp2',
  'stopped',
  'invalidated',
  'expired',
] as const;
export const SetupStatusSchema = z.enum(SETUP_STATUSES);
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

/** Statuses after which a setup never changes again. */
export const TERMINAL_SETUP_STATUSES: readonly SetupStatus[] = ['tp2', 'stopped', 'invalidated', 'expired'];
/** Statuses that count as "closed trades" in the journal (had a trigger and an outcome). */
export const JOURNAL_SETUP_STATUSES: readonly SetupStatus[] = ['tp1', 'tp2', 'stopped'];

export const RR_TP1 = 1.5;
export const RR_TP2 = 2;

export const BiasSchema = z.object({
  tf: z.enum(['M30', 'M15']),
  trend: TrendSchema,
  lastEvent: StructureEventKindSchema.nullable(),
  eventPrice: z.number().finite(),
});
export type Bias = z.infer<typeof BiasSchema>;

export const SetupZoneSchema = z.object({
  id: z.string().min(1),
  tf: TimeframeSchema,
  type: ZoneTypeSchema,
  top: z.number().finite(),
  bottom: z.number().finite(),
  score: z.number().min(0).max(100),
  fresh: z.boolean(),
  pattern: ZonePatternSchema,
});
export type SetupZone = z.infer<typeof SetupZoneSchema>;

export const PressureSchema = z.object({
  score: z.number().min(0).max(100),
  patterns: z.array(z.string()),
});

export const SetupSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1).default('XAUUSD'),
  playbook: PlaybookIdSchema,
  direction: DirectionSchema,
  status: SetupStatusSchema,
  bias: BiasSchema,
  zone: SetupZoneSchema,
  entry: z.number().finite(),
  stopLoss: z.number().finite(),
  tp1: z.number().finite(),
  tp2: z.number().finite(),
  riskPts: z.number().positive(),
  rr: z.object({ tp1: z.literal(RR_TP1), tp2: z.literal(RR_TP2) }),
  pressure: PressureSchema.nullable(),
  rationale: z.object({
    deterministic: z.array(z.string()),
    llm: z.string().optional(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** Set when the entry is first touched. */
  triggeredAt: z.iso.datetime().optional(),
  /** Set on tp1/tp2/stopped/invalidated/expired. */
  closedAt: z.iso.datetime().optional(),
  /** Realized R multiple once closed (tp1 → 1.5, tp2 → 2, stopped → -1; partial logic lives in the engine). */
  realizedR: z.number().finite().optional(),
  /** Best R reached while open (for the R progress bar). */
  maxFavorableR: z.number().finite().optional(),
});
export type Setup = z.infer<typeof SetupSchema>;
export type SetupInput = z.input<typeof SetupSchema>;

export function isTerminalStatus(status: SetupStatus): boolean {
  return TERMINAL_SETUP_STATUSES.includes(status);
}

export function isJournalStatus(status: SetupStatus): boolean {
  return JOURNAL_SETUP_STATUSES.includes(status);
}
