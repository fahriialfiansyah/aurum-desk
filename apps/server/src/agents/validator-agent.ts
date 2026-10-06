import { completeJson, LlmError } from '@aurum/llm';
import { formatPrice, type Candle, type Setup } from '@aurum/shared';
import { z } from 'zod';
import { AGENT_MAX_TOKENS, SYSTEM_PROMPT_COMMON, tokenPair, truncate, type AgentContext, type AgentOutcome } from './types';

export type ValidatorInput = { setup: Setup; candles: readonly Candle[] };

const CANDLES_IN_PROMPT = 6;

const outputSchema = z.object({
  verdict: z.enum(['valid', 'reject']),
  reasons: z.array(z.string().min(1).max(160)).min(1).max(4),
  confidence: z.number().min(0).max(1),
});

/** Rule-based verdict mirrors the engine: pressure confirmed ⇒ valid. */
export function describeValidation(input: ValidatorInput): { verdict: 'valid' | 'reject'; reasons: string[] } {
  const { setup } = input;
  const p = setup.pressure;
  if (!p || !p.patterns.length) {
    return { verdict: 'reject', reasons: ['Harga sudah menyentuh zona tetapi belum ada pola buying/selling pressure (rejection wick, engulfing, pin bar, inside-bar break, ekspansi beruntun).'] };
  }
  const dir = setup.direction === 'long' ? 'buying' : 'selling';
  return {
    verdict: setup.status === 'watching' ? 'reject' : 'valid',
    reasons: [
      `${dir} pressure terkonfirmasi: ${p.patterns.join(', ')} (skor ${p.score}/100).`,
      `Entry ${formatPrice(setup.entry)} di tepi zona ${setup.zone.type} ${setup.zone.tf}, SL ${formatPrice(setup.stopLoss)} di luar zona.`,
    ],
  };
}

export async function runValidatorAgent(input: ValidatorInput, ctx: AgentContext): Promise<AgentOutcome> {
  const { setup } = input;
  const rules = describeValidation(input);
  const head = `${setup.direction.toUpperCase()} @ ${formatPrice(setup.entry)}`;
  const base = { agent: 'validator' as const, setupId: setup.id };
  const fromRules = (): AgentOutcome => ({
    ...base,
    level: rules.verdict === 'valid' ? 'success' : 'info',
    summary: `${head}: ${rules.verdict.toUpperCase()} — ${truncate(rules.reasons[0] ?? '', 110)}`,
    detail: rules.reasons.join(' '),
    source: 'rules',
    rationale: `Validator: ${rules.verdict} — ${rules.reasons.join(' ')}`,
  });
  if (!ctx.llm || !ctx.allowLlm()) return fromRules();
  const payload = JSON.stringify({
    direction: setup.direction,
    zone: setup.zone,
    levels: { entry: setup.entry, stopLoss: setup.stopLoss, tp1: setup.tp1, tp2: setup.tp2, riskPts: setup.riskPts },
    engineStatus: setup.status,
    pressure: setup.pressure,
    lastCandles: input.candles.slice(-CANDLES_IN_PROMPT).map((c) => ({ o: c.open, h: c.high, l: c.low, c: c.close })),
  });
  try {
    const { data, usage } = await completeJson(
      ctx.llm,
      [{ role: 'user', content: `Harga sedang berada di zona setup ini. Nilai apakah price action mengonfirmasi ${setup.direction === 'long' ? 'buying' : 'selling'} pressure. Beri verdict valid/reject dan 1–4 alasan singkat.\n${payload}` }],
      outputSchema,
      { system: SYSTEM_PROMPT_COMMON, maxTokens: AGENT_MAX_TOKENS, effort: 'low', schemaName: 'validation' },
    );
    ctx.spend.record(usage, ctx.llm.model);
    const engineValid = setup.status !== 'watching';
    const disagree = (data.verdict === 'valid') !== engineValid;
    const note = disagree ? ` · ⚠ berbeda dengan engine (${engineValid ? 'valid' : 'watching'})` : '';
    return {
      ...base,
      level: disagree ? 'warn' : data.verdict === 'valid' ? 'success' : 'info',
      summary: `${head}: ${data.verdict.toUpperCase()} (${data.confidence.toFixed(2)}) — ${truncate(data.reasons[0] ?? '', 100)}${note}`,
      detail: data.reasons.join(' '),
      source: 'llm',
      tokens: tokenPair(usage),
      rationale: `Validator: ${data.verdict} (${data.confidence.toFixed(2)}) — ${data.reasons.join(' ')}`,
    };
  } catch (error) {
    ctx.onLlmFallback('validator', error instanceof LlmError ? error.message : String(error));
    return fromRules();
  }
}
