import { completeJson, LlmError } from '@aurum/llm';
import { formatPrice, type MarketStructure, type Timeframe } from '@aurum/shared';
import { z } from 'zod';
import { AGENT_MAX_TOKENS, SYSTEM_PROMPT_COMMON, tokenPair, truncate, type AgentContext, type AgentOutcome } from './types';

export type StructureInput = { tf: Timeframe; structure: MarketStructure; lastClose: number };

const outputSchema = z.object({
  trend: z.enum(['bullish', 'bearish', 'ranging']),
  narrative: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});

const SWINGS_IN_PROMPT = 8;
const EVENTS_IN_PROMPT = 4;

/** Deterministic Indonesian bias narrative used when no LLM is configured (or it fails). */
export function describeStructure(input: StructureInput): { narrative: string; confidence: number } {
  const { tf, structure } = input;
  const labels = structure.swings.filter((s) => s.label).slice(-4).map((s) => s.label);
  const last = structure.lastEvent;
  const eventText = last ? `${last.kind} ${last.direction} terakhir @ ${formatPrice(last.price)}` : 'belum ada BOS/CHoCH';
  const seq = labels.length > 0 ? `urutan swing ${labels.join('→')}` : 'swing belum cukup';
  const sameDir = structure.events.slice(-3).filter((e) => e.direction === last?.direction).length;
  const confidence = structure.trend === 'ranging' ? 0.3 : Math.min(0.9, 0.5 + 0.15 * sameDir);
  const narrative =
    structure.trend === 'ranging'
      ? `Struktur ${tf} ranging — ${eventText}; ${seq}. Tunggu break yang jelas sebelum ambil bias.`
      : `Struktur ${tf} ${structure.trend}: ${eventText}; ${seq}. ${last?.kind === 'CHoCH' ? 'Arah baru setelah CHoCH, konfirmasi BOS lanjutan masih ditunggu.' : 'Tren berlanjut selama tidak ada CHoCH.'}`;
  return { narrative, confidence: Math.round(confidence * 100) / 100 };
}

function promptPayload(input: StructureInput): string {
  const { structure } = input;
  return JSON.stringify({
    timeframe: input.tf,
    engineTrend: structure.trend,
    lastClose: input.lastClose,
    swings: structure.swings.slice(-SWINGS_IN_PROMPT).map((s) => ({ label: s.label, kind: s.kind, price: s.price })),
    events: structure.events.slice(-EVENTS_IN_PROMPT).map((e) => ({ kind: e.kind, direction: e.direction, price: e.price })),
  });
}

export async function runStructureAgent(input: StructureInput, ctx: AgentContext): Promise<AgentOutcome> {
  const rules = describeStructure(input);
  const base = { agent: 'structure' as const, level: 'info' as const };
  if (!ctx.llm || !ctx.allowLlm()) {
    return { ...base, summary: `${input.tf} ${input.structure.trend} (${rules.confidence}) — ${truncate(rules.narrative, 110)}`, detail: rules.narrative, source: 'rules' };
  }
  try {
    const { data, usage } = await completeJson(
      ctx.llm,
      [{ role: 'user', content: `Analisa struktur pasar berikut dan beri narasi bias singkat (≤ 3 kalimat) serta confidence 0–1.\n${promptPayload(input)}` }],
      outputSchema,
      { system: SYSTEM_PROMPT_COMMON, maxTokens: AGENT_MAX_TOKENS, effort: 'low', schemaName: 'structure_bias' },
    );
    ctx.spend.record(usage, ctx.llm.model);
    const disagree = data.trend !== input.structure.trend ? ` · ⚠ LLM membaca ${data.trend}, engine ${input.structure.trend}` : '';
    return {
      ...base,
      level: disagree ? 'warn' : 'info',
      summary: `${input.tf} ${input.structure.trend} (${data.confidence.toFixed(2)}) — ${truncate(data.narrative, 100)}${disagree}`,
      detail: data.narrative,
      source: 'llm',
      tokens: tokenPair(usage),
    };
  } catch (error) {
    ctx.onLlmFallback('structure', error instanceof LlmError ? error.message : String(error));
    return { ...base, summary: `${input.tf} ${input.structure.trend} (${rules.confidence}) — ${truncate(rules.narrative, 110)}`, detail: rules.narrative, source: 'rules' };
  }
}
