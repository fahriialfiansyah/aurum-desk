import { AnthropicProvider } from './providers/anthropic';
import { OllamaProvider } from './providers/ollama';
import { OpenAIProvider } from './providers/openai';
import type { LLMProvider } from './types';

export type LlmConfig =
  | { provider: 'none' }
  | { provider: 'anthropic'; apiKey: string; model?: string }
  | { provider: 'openai'; apiKey: string; model?: string }
  | { provider: 'ollama'; baseUrl?: string; model?: string };

/** Returns null for `none`: callers then use their deterministic, rule-based path and say so. */
export function createLlmProvider(config: LlmConfig): LLMProvider | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'anthropic':
      return new AnthropicProvider({ apiKey: config.apiKey, ...(config.model ? { model: config.model } : {}) });
    case 'openai':
      return new OpenAIProvider({ apiKey: config.apiKey, ...(config.model ? { model: config.model } : {}) });
    case 'ollama':
      return new OllamaProvider({ ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}), ...(config.model ? { model: config.model } : {}) });
    default: {
      const never: never = config;
      throw new Error(`LLM provider tidak dikenal: ${JSON.stringify(never)}`);
    }
  }
}
