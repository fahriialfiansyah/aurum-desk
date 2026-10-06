import { z } from 'zod';
import { TimeframeSchema } from './timeframe';

export const AGENT_NAMES = ['structure', 'zones', 'validator', 'risk', 'copilot', 'system'] as const;
export const AgentNameSchema = z.enum(AGENT_NAMES);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const AGENT_LABELS: Record<AgentName, string> = {
  structure: 'Structure',
  zones: 'Zones',
  validator: 'Validator',
  risk: 'Risk',
  copilot: 'Copilot',
  system: 'System',
};

export const AgentEventLevelSchema = z.enum(['info', 'success', 'warn', 'error']);
export type AgentEventLevel = z.infer<typeof AgentEventLevelSchema>;

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  ts: z.iso.datetime(),
  agent: AgentNameSchema,
  level: AgentEventLevelSchema,
  summary: z.string().min(1),
  detail: z.string().optional(),
  setupId: z.string().optional(),
  tf: TimeframeSchema.optional(),
  /** 'llm' when a model produced the content, 'rules' when the deterministic fallback did. */
  source: z.enum(['llm', 'rules']).optional(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AgentStateSchema = z.object({
  agent: AgentNameSchema,
  state: z.enum(['idle', 'running', 'error', 'disabled']),
  lastRunAt: z.iso.datetime().nullable(),
  lastSummary: z.string().nullable(),
  runs: z.number().int().nonnegative(),
  mode: z.enum(['llm', 'rules']),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
