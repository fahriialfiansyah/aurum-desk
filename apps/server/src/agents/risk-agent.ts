import { DEFAULT_PARAMS, positionSize } from '@aurum/engine';
import { completeJson, LlmError } from '@aurum/llm';
import { RR_TP1, RR_TP2, formatPrice, type Setup } from '@aurum/shared';
import { z } from 'zod';
import { AGENT_MAX_TOKENS, SYSTEM_PROMPT_COMMON, tokenPair, truncate, type AgentContext, type AgentOutcome } from './types';

export type RiskInput = { setup: Setup; atr: number | null; accountSize: number; riskPercent: number };

export type RiskCheck = { name: string; ok: boolean; detail: string };

const RR_TOLERANCE = 0.011;
const MIN_RISK_ATR = 0.3;
const MAX_RISK_ATR = 4;

/** Deterministic sanity checks: RR exactly 1.5/2, SL outside the zone, risk distance sane vs ATR, position size. */
export function riskChecks(input: RiskInput): { ok: boolean; checks: RiskCheck[]; lots: number; riskAmount: number } {
  const { setup, atr } = input;
  const sign = setup.direction === 'long' ? 1 : -1;
  const rr1 = (sign * (setup.tp1 - setup.entry)) / setup.riskPts;
  const rr2 = (sign * (setup.tp2 - setup.entry)) / setup.riskPts;
  const slOutside = setup.direction === 'long' ? setup.stopLoss < setup.zone.bottom : setup.stopLoss > setup.zone.top;
  const ratio = atr && atr > 0 ? setup.riskPts / atr : null;
  const checks: RiskCheck[] = [
    { name: 'RR TP1', ok: Math.abs(rr1 - RR_TP1) <= RR_TOLERANCE, detail: `1:${rr1.toFixed(2)} (target 1:${RR_TP1})` },
    { name: 'RR TP2', ok: Math.abs(rr2 - RR_TP2) <= RR_TOLERANCE, detail: `1:${rr2.toFixed(2)} (target 1:${RR_TP2})` },
    { name: 'SL di luar zona', ok: slOutside, detail: `SL ${formatPrice(setup.stopLoss)} vs zona ${formatPrice(setup.zone.bottom)}–${formatPrice(setup.zone.top)}` },
    {
      name: 'Jarak risiko vs ATR',
      ok: ratio === null ? true : ratio >= MIN_RISK_ATR && ratio <= MAX_RISK_ATR,
      detail: ratio === null ? 'ATR belum tersedia' : `${formatPrice(setup.riskPts)} pt = ${ratio.toFixed(2)}× ATR`,
    },
  ];
  const size = positionSize({ accountSize: input.accountSize, riskPercent: input.riskPercent, riskPts: setup.riskPts }, DEFAULT_PARAMS.risk);
  return { ok: checks.every((c) => c.ok), checks, lots: size.lots, riskAmount: size.riskAmount };
}

export function describeRisk(input: RiskInput): string {
  const r = riskChecks(input);
  const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.name} ✗ ${c.detail}`);
  return (
    `Risk ${r.ok ? 'OK' : 'PERLU PERHATIAN'} · ${r.lots.toFixed(2)} lot (${input.riskPercent}% dari $${input.accountSize.toLocaleString('en-US')} = $${r.riskAmount}) · ` +
    `RR 1:${RR_TP1}/1:${RR_TP2} ${r.checks[0]?.ok && r.checks[1]?.ok ? '✓' : '✗'} · SL ${r.checks[2]?.ok ? 'di luar zona ✓' : 'DI DALAM ZONA ✗'}` +
    (failed.length ? ` · ${failed.join('; ')}` : '')
  );
}

const outputSchema = z.object({
  note: z.string().min(1).max(300),
  flags: z.array(z.string().max(120)).max(3),
});

export async function runRiskAgent(input: RiskInput, ctx: AgentContext): Promise<AgentOutcome> {
  const checks = riskChecks(input);
  const rules = describeRisk(input);
  const base = { agent: 'risk' as const, setupId: input.setup.id, level: checks.ok ? ('success' as const) : ('warn' as const) };
  const fromRules = (): AgentOutcome => ({ ...base, summary: truncate(rules, 160), detail: rules, source: 'rules', rationale: rules });
  if (!ctx.llm || !ctx.allowLlm()) return fromRules();
  const payload = JSON.stringify({ setup: { direction: input.setup.direction, entry: input.setup.entry, stopLoss: input.setup.stopLoss, tp1: input.setup.tp1, tp2: input.setup.tp2, riskPts: input.setup.riskPts }, atr: input.atr, checks: checks.checks, lots: checks.lots, riskAmount: checks.riskAmount });
  try {
    const { data, usage } = await completeJson(
      ctx.llm,
      [{ role: 'user', content: `Berikan catatan risiko singkat (≤ 2 kalimat) dan maksimal 3 flag untuk setup ini berdasarkan hasil pemeriksaan deterministik berikut. Jangan mengubah angka.\n${payload}` }],
      outputSchema,
      { system: SYSTEM_PROMPT_COMMON, maxTokens: AGENT_MAX_TOKENS, effort: 'low', schemaName: 'risk_note' },
    );
    ctx.spend.record(usage, ctx.llm.model);
    const text = `${rules} · ${data.note}${data.flags.length ? ` · flags: ${data.flags.join('; ')}` : ''}`;
    return { ...base, summary: truncate(text, 170), detail: text, source: 'llm', tokens: tokenPair(usage), rationale: text };
  } catch (error) {
    ctx.onLlmFallback('risk', error instanceof LlmError ? error.message : String(error));
    return fromRules();
  }
}
