import type { LLMProvider, SpendTracker } from '@aurum/llm';
import type { AgentEventLevel, AgentName } from '@aurum/shared';

/** What every specialist agent returns; the orchestrator turns it into an activity-log event. */
export type AgentOutcome = {
  agent: AgentName;
  level: AgentEventLevel;
  summary: string;
  detail?: string;
  source: 'llm' | 'rules';
  tokens?: { input: number; output: number };
  /** Text to attach to the setup's `rationale.llm` (if the agent concerns a setup). */
  rationale?: string;
  setupId?: string;
};

export type AgentContext = {
  llm: LLMProvider | null;
  spend: SpendTracker;
  /** Hard switch evaluated per call: provider configured AND budget left. */
  allowLlm(): boolean;
  /** Called when an LLM path failed and the rule-based path was used instead. */
  onLlmFallback(agent: AgentName, reason: string): void;
};

export const SYSTEM_PROMPT_COMMON = [
  'Kamu adalah agen analis di meja trading XAUUSD pribadi. Jawab dalam Bahasa Indonesia yang ringkas dan teknis.',
  'Istilah trading tetap dalam bahasa Inggris: BOS, CHoCH, supply/demand, RR, SL/TP, HH/HL/LH/LL.',
  'ATURAN KERAS: jangan pernah menyebut level harga yang tidak ada di data input. Semua level sudah dihitung oleh engine deterministik.',
  'Kamu hanya menalar, memvalidasi, memberi peringkat, dan menjelaskan. Jangan memberi saran eksekusi order.',
  'Balas hanya dengan JSON sesuai skema yang diminta.',
].join(' ');

export const AGENT_MAX_TOKENS = 600;

export function tokenPair(usage: { inputTokens: number; outputTokens: number }): { input: number; output: number } {
  return { input: usage.inputTokens, output: usage.outputTokens };
}

export function truncate(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
