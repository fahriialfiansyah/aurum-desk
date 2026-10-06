import type { LlmProviderName } from './types';

/** USD per 1M tokens (input, output). Unknown models cost 0 and are flagged. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
};

export function estimateUsd(provider: LlmProviderName, model: string, inputTokens: number, outputTokens: number): number {
  if (provider === 'ollama') return 0;
  const price = PRICE_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function isPriced(provider: LlmProviderName, model: string): boolean {
  return provider === 'ollama' || model in PRICE_PER_MTOK;
}
