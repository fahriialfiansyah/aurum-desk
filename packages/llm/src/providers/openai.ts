import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import {
  DEFAULT_MAX_TOKENS,
  LlmError,
  type CompleteOptions,
  type CompleteResult,
  type LLMProvider,
  type LlmMessage,
  type LlmStopReason,
  type LlmToolCall,
} from '../types';

export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';

type OpenAIClientLike = Pick<OpenAI, 'chat'>;

function toOpenAIMessages(messages: LlmMessage[], system?: string): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    } else out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

function mapFinish(reason: string | null | undefined): LlmStopReason {
  switch (reason) {
    case 'stop':
      return 'end';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** OpenAI Chat Completions with tools and JSON-schema structured outputs. */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly client: OpenAIClientLike;

  constructor(options: { apiKey?: string; model?: string; client?: OpenAIClientLike } = {}) {
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.client = options.client ?? new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async complete(messages: LlmMessage[], options: CompleteOptions = {}): Promise<CompleteResult> {
    const base: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: toOpenAIMessages(messages, options.system),
      max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
        : {}),
      ...(options.outputSchema ? { response_format: zodResponseFormat(options.outputSchema as never, options.outputSchemaName ?? 'response') } : {}),
    };
    try {
      if (options.onToken) return await this.streamed(base, options);
      const res = await this.client.chat.completions.create(base, { signal: options.signal });
      const choice = res.choices[0];
      return {
        text: choice?.message.content ?? '',
        toolCalls: (choice?.message.tool_calls ?? [])
          .filter((c): c is OpenAI.ChatCompletionMessageFunctionToolCall => c.type === 'function')
          .map((c) => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) })),
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        stopReason: mapFinish(choice?.finish_reason),
        model: res.model ?? this.model,
      };
    } catch (error) {
      if (error instanceof OpenAI.RateLimitError) throw new LlmError(`OpenAI rate limit: ${error.message}`, true);
      if (error instanceof OpenAI.AuthenticationError) throw new LlmError('OpenAI: API key tidak valid', false);
      if (error instanceof OpenAI.APIConnectionError) throw new LlmError(`OpenAI: koneksi gagal (${error.message})`, true);
      if (error instanceof OpenAI.APIError) throw new LlmError(`OpenAI API ${error.status}: ${error.message}`, (error.status ?? 500) >= 500);
      throw error;
    }
  }

  private async streamed(base: OpenAI.ChatCompletionCreateParamsNonStreaming, options: CompleteOptions): Promise<CompleteResult> {
    const stream = await this.client.chat.completions.create(
      { ...base, stream: true, stream_options: { include_usage: true } },
      { signal: options.signal },
    );
    let text = '';
    let finish: string | null | undefined;
    let model = this.model;
    const usage = { inputTokens: 0, outputTokens: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for await (const chunk of stream) {
      model = chunk.model ?? model;
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens;
        usage.outputTokens = chunk.usage.completion_tokens;
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.delta.content) {
        text += choice.delta.content;
        options.onToken?.(choice.delta.content);
      }
      for (const tc of choice.delta.tool_calls ?? []) {
        const entry = calls.get(tc.index) ?? { id: tc.id ?? '', name: '', args: '' };
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
        calls.set(tc.index, entry);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    const toolCalls: LlmToolCall[] = [...calls.values()].map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.args) }));
    return { text, toolCalls, usage, stopReason: mapFinish(finish), model };
  }
}
