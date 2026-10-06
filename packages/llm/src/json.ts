import type { z } from 'zod';
import { LlmOutputError, type CompleteOptions, type LLMProvider, type LlmMessage, type LlmUsage } from './types';

export type JsonCompletion<T> = { data: T; usage: LlmUsage; attempts: number; model: string };

/** Pulls the first JSON object out of prose or ```json fences. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) return candidate.slice(start, end + 1);
  return candidate;
}

function parseWith<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (error) {
    return { ok: false, error: `JSON tidak valid: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return { ok: false, error: `Skema tidak terpenuhi: ${issues}` };
}

/**
 * Structured completion validated with zod. On a parse failure the model gets ONE corrective
 * retry; a second failure throws `LlmOutputError` so the caller can fall back to deterministic output.
 */
export async function completeJson<T>(
  provider: LLMProvider,
  messages: LlmMessage[],
  schema: z.ZodType<T>,
  options: Omit<CompleteOptions, 'outputSchema' | 'tools'> & { schemaName?: string } = {},
): Promise<JsonCompletion<T>> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const base = { ...options, outputSchema: schema, outputSchemaName: options.schemaName ?? 'response' };
  let model = provider.model;
  let lastText = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const convo: LlmMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            { role: 'assistant', content: lastText },
            { role: 'user', content: 'Output sebelumnya tidak valid. Balas HANYA dengan satu objek JSON yang persis mengikuti skema, tanpa teks lain.' },
          ];
    const result = await provider.complete(convo, base);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    model = result.model;
    lastText = result.text;
    if (result.stopReason === 'refusal') throw new LlmOutputError('Model menolak permintaan (refusal)', result.text);
    const parsed = parseWith(schema, result.text);
    if (parsed.ok) return { data: parsed.data, usage, attempts: attempt, model };
    if (attempt === 2) throw new LlmOutputError(parsed.error, result.text);
  }
  throw new LlmOutputError('unreachable', lastText);
}
