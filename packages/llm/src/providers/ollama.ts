import { z } from 'zod';
import {
  DEFAULT_MAX_TOKENS,
  LlmError,
  type CompleteOptions,
  type CompleteResult,
  type LLMProvider,
  type LlmMessage,
  type LlmToolCall,
} from '../types';

export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

type OllamaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }
  | { role: 'tool'; content: string; tool_name: string };

const chunkSchema = z.object({
  model: z.string().optional(),
  message: z
    .object({
      role: z.string().optional(),
      content: z.string().optional(),
      tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }) })).optional(),
    })
    .optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
  error: z.string().optional(),
});

function toOllamaMessages(messages: LlmMessage[], system?: string): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant')
      out.push({
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls && m.toolCalls.length > 0 ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}),
      });
    else out.push({ role: 'tool', content: m.content, tool_name: m.name });
  }
  return out;
}

/** Local models through Ollama's /api/chat (NDJSON streaming, tools, JSON-schema `format`). */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl?: string; model?: string; fetchImpl?: typeof fetch } = {}) {
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(messages: LlmMessage[], options: CompleteOptions = {}): Promise<CompleteResult> {
    const body = {
      model: this.model,
      messages: toOllamaMessages(messages, options.system),
      stream: true,
      options: { num_predict: options.maxTokens ?? DEFAULT_MAX_TOKENS, ...(options.temperature !== undefined ? { temperature: options.temperature } : {}) },
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
        : {}),
      ...(options.outputSchema ? { format: z.toJSONSchema(options.outputSchema) } : {}),
    };
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal ?? null,
      });
    } catch (error) {
      throw new LlmError(`Ollama tidak terjangkau di ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new LlmError(`Ollama HTTP ${response.status}: ${detail.slice(0, 200)}`, response.status >= 500);
    }
    return this.readStream(response.body, options);
  }

  private async readStream(stream: ReadableStream<Uint8Array>, options: CompleteOptions): Promise<CompleteResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let model = this.model;
    const toolCalls: LlmToolCall[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let doneReason = '';
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const parsed = chunkSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return;
      const chunk = parsed.data;
      if (chunk.error) throw new LlmError(`Ollama: ${chunk.error}`, false);
      if (chunk.model) model = chunk.model;
      if (chunk.message?.content) {
        text += chunk.message.content;
        options.onToken?.(chunk.message.content);
      }
      for (const call of chunk.message?.tool_calls ?? []) {
        toolCalls.push({ id: `call_${toolCalls.length + 1}`, name: call.function.name, args: call.function.arguments });
      }
      if (chunk.done) {
        usage.inputTokens = chunk.prompt_eval_count ?? 0;
        usage.outputTokens = chunk.eval_count ?? 0;
        doneReason = chunk.done_reason ?? '';
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    if (buffer.trim()) handleLine(buffer);
    const stopReason = toolCalls.length > 0 ? 'tool_use' : doneReason === 'length' ? 'max_tokens' : 'end';
    return { text, toolCalls, usage, stopReason, model };
  }
}
