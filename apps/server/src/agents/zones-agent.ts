import type { PlaybookResult } from '@aurum/engine';
import { completeJson, LlmError } from '@aurum/llm';
import { PLAYBOOKS, formatPrice } from '@aurum/shared';
import { z } from 'zod';
import { AGENT_MAX_TOKENS, SYSTEM_PROMPT_COMMON, tokenPair, truncate, type AgentContext, type AgentOutcome } from './types';

export type ZonesInput = { result: PlaybookResult; price: number };

const CANDIDATES_IN_PROMPT = 5;

/** Deterministic explanation of the engine's pick (or of why there is none). */
export function describeZonePick(input: ZonesInput): string {
  const { result } = input;
  const label = PLAYBOOKS[result.playbook].shortLabel;
  if (!result.best) return `Playbook ${label}: tidak ada setup — ${result.reasons.join('; ')}`;
  const z = result.best.zone;
  const alt = result.runnerUps.map((r) => `${r.pattern} ${formatPrice(r.bottom)}–${formatPrice(r.top)} (skor ${r.score})`).join(', ');
  return (
    `Playbook ${label}: zona ${z.type} ${z.tf} ${formatPrice(z.bottom)}–${formatPrice(z.top)} dipilih (${z.pattern}, skor ${z.score}, ${z.fresh ? 'fresh' : 'tested'}) ` +
    `karena searah bias ${result.bias.tf} ${result.bias.trend} dan skor tertinggi di antara ${result.candidates.length} kandidat` +
    (alt ? `. Alternatif: ${alt}.` : '.')
  );
}

export async function runZonesAgent(input: ZonesInput, ctx: AgentContext): Promise<AgentOutcome> {
  const { result } = input;
  const label = PLAYBOOKS[result.playbook].shortLabel;
  const rules = describeZonePick(input);
  const base = { agent: 'zones' as const, level: 'info' as const, setupId: result.best?.id };
  if (!result.best || !ctx.llm || !ctx.allowLlm()) {
    return { ...base, summary: truncate(rules, 150), detail: rules, source: 'rules', rationale: result.best ? rules : undefined };
  }
  const candidates = result.candidates.slice(0, CANDIDATES_IN_PROMPT);
  const ids = candidates.map((c) => c.id);
  const outputSchema = z.object({
    pickZoneId: z.string(),
    agreesWithEngine: z.boolean(),
    reasoning: z.string().min(1).max(600),
  });
  const payload = JSON.stringify({
    playbook: `${label} ${PLAYBOOKS[result.playbook].biasTf}→${PLAYBOOKS[result.playbook].entryTf}`,
    bias: result.bias,
    price: input.price,
    enginePickZoneId: result.candidates[0]?.id ?? result.best.zone.id,
    candidates: candidates.map((c) => ({ id: c.id, type: c.type, pattern: c.pattern, top: c.top, bottom: c.bottom, score: c.score, breakdown: c.scoreBreakdown, fresh: c.fresh })),
  });
  try {
    const { data, usage } = await completeJson(
      ctx.llm,
      [{ role: 'user', content: `Pilih zona paling menarik untuk playbook ini dari daftar kandidat (pickZoneId HARUS salah satu id kandidat) dan jelaskan alasannya dalam ≤ 3 kalimat.\n${payload}` }],
      outputSchema.refine((d) => ids.includes(d.pickZoneId), { message: 'pickZoneId harus salah satu id kandidat' }),
      { system: SYSTEM_PROMPT_COMMON, maxTokens: AGENT_MAX_TOKENS, effort: 'low', schemaName: 'zone_pick' },
    );
    ctx.spend.record(usage, ctx.llm.model);
    const enginePick = result.candidates[0]?.id;
    const disagree = data.pickZoneId !== enginePick;
    const note = disagree ? ` · ⚠ LLM lebih suka ${data.pickZoneId}; engine tetap memakai pilihannya` : '';
    return {
      ...base,
      level: disagree ? 'warn' : 'info',
      summary: `Playbook ${label}: ${truncate(data.reasoning, 120)}${note}`,
      detail: data.reasoning,
      source: 'llm',
      tokens: tokenPair(usage),
      rationale: data.reasoning,
    };
  } catch (error) {
    ctx.onLlmFallback('zones', error instanceof LlmError ? error.message : String(error));
    return { ...base, summary: truncate(rules, 150), detail: rules, source: 'rules', rationale: rules };
  }
}
