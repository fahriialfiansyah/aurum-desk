import type { z } from 'zod';

export const LLM_PROVIDER_NAMES = ['anthropic', 'openai', 'ollama'] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export type LlmToolCall = { id: string; name: string; args: Record<string, unknown> };

/** Provider-agnostic conversation turn. Tool results are their own turn so every provider can map them. */
export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type LlmToolDef = {
  name: string;
  description: string;
  /** JSON Schema (object) for the tool input. */
  inputSchema: Record<string, unknown>;
};

export type LlmEffort = 'low' | 'medium' | 'high';

export type CompleteOptions = {
  system?: string;
  tools?: LlmToolDef[];
  /** When set, the provider asks for JSON matching this zod schema (structured output). */
  outputSchema?: z.ZodType;
  outputSchemaName?: string;
  maxTokens?: number;
  temperature?: number;
  effort?: LlmEffort;
  /** Streaming text callback (chat). Providers call it as tokens arrive. */
  onToken?: (text: string) => void;
  signal?: AbortSignal;
};

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type CompleteResult = {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage;
  stopReason: LlmStopReason;
  model: string;
};

export interface LLMProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  complete(messages: LlmMessage[], options?: CompleteOptions): Promise<CompleteResult>;
}

export class LlmError extends Error {
  override readonly name: string = 'LlmError';
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

/** Raised when the model's output does not satisfy the zod schema after a retry. */
export class LlmOutputError extends LlmError {
  override readonly name = 'LlmOutputError';
  readonly rawText: string;
  constructor(message: string, rawText: string) {
    super(message, false);
    this.rawText = rawText;
  }
}

export const DEFAULT_MAX_TOKENS = 1024;
