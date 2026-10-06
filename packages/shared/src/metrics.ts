import { z } from 'zod';
import { FeedStatusSchema } from './feed';
import { SessionSchema } from './session';

export const LlmSpendSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
  estimatedUsd: z.number().nonnegative(),
  dailyBudgetTokens: z.number().int().nonnegative(),
  provider: z.string(),
  model: z.string().nullable(),
});
export type LlmSpend = z.infer<typeof LlmSpendSchema>;

export const MetricsSchema = z.object({
  symbol: z.string(),
  lastPrice: z.number().nullable(),
  /** Change vs. the previous M1 close. */
  change: z.number().nullable(),
  changePct: z.number().nullable(),
  /** Change since the start of the current UTC day. */
  dayChange: z.number().nullable(),
  atrM15: z.number().nullable(),
  spread: z.number().nullable(),
  session: SessionSchema,
  setupsToday: z.number().int().nonnegative(),
  activeSetups: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1).nullable(),
  avgR: z.number().nullable(),
  journalCount: z.number().int().nonnegative(),
  llm: LlmSpendSchema,
  feed: FeedStatusSchema,
  serverTime: z.iso.datetime(),
});
export type Metrics = z.infer<typeof MetricsSchema>;
