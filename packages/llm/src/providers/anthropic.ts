import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
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

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

type AnthropicClientLike = Pick<Anthropic, 'messages'>;

function toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const call of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : m.content });
    } else {
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      // Consecutive tool results must share ONE user message.
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content = [...(last.content as Anthropic.ContentBlockParam[]), block];
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

function mapStop(reason: Anthropic.Message['stop_reason']): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** Claude via the official SDK. Thinking is adaptive by default on current models; depth is set with `effort`. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: AnthropicClientLike;

  constructor(options: { apiKey?: string; model?: string; client?: AnthropicClientLike } = {}) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async complete(messages: LlmMessage[], options: CompleteOptions = {}): Promise<CompleteResult> {
    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(messages),
      ...(options.system ? { system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }] } : {}),
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })) }
        : {}),
      output_config: {
        effort: options.effort ?? 'low',
        ...(options.outputSchema ? { format: zodOutputFormat(options.outputSchema as never) } : {}),
      },
    };

    try {
      const final = options.onToken ? await this.streamed(params, options) : await this.client.messages.create(params, { signal: options.signal });
      return this.toResult(final);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new LlmError(`Anthropic rate limit: ${error.message}`, true);
      if (error instanceof Anthropic.AuthenticationError) throw new LlmError('Anthropic: API key tidak valid', false);
      if (error instanceof Anthropic.APIConnectionError) throw new LlmError(`Anthropic: koneksi gagal (${error.message})`, true);
      if (error instanceof Anthropic.APIError) throw new LlmError(`Anthropic API ${error.status}: ${error.message}`, (error.status ?? 500) >= 500);
      throw error;
    }
  }

  private async streamed(params: Anthropic.MessageCreateParams, options: CompleteOptions): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream({ ...params, stream: true }, { signal: options.signal });
    stream.on('text', (text) => options.onToken?.(text));
    return stream.finalMessage();
  }

  private toResult(message: Anthropic.Message): CompleteResult {
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const toolCalls: LlmToolCall[] = message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }));
    return {
      text,
      toolCalls,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      stopReason: mapStop(message.stop_reason),
      model: message.model,
    };
  }
}
