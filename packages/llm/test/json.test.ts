import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { completeJson, extractJson } from '../src/json';
import { LlmOutputError } from '../src/types';
import { FakeProvider } from './fake-provider';

const schema = z.object({ verdict: z.enum(['valid', 'reject']), confidence: z.number().min(0).max(1) });

describe('extractJson', () => {
  test('handles fences and surrounding prose', () => {
    expect(extractJson('Berikut:\n```json\n{"a":1}\n```\nselesai')).toBe('{"a":1}');
    expect(extractJson('oke {"a": {"b": 2}} trailing')).toBe('{"a": {"b": 2}}');
  });
});

describe('completeJson', () => {
  test('returns validated data on the first attempt and sums usage', async () => {
    const p = new FakeProvider([{ text: '{"verdict":"valid","confidence":0.8}' }]);
    const r = await completeJson(p, [{ role: 'user', content: 'x' }], schema);
    expect(r.data).toEqual({ verdict: 'valid', confidence: 0.8 });
    expect(r.attempts).toBe(1);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(p.calls[0]?.options.outputSchema).toBe(schema);
  });

  test('retries once with a corrective message, then succeeds', async () => {
    const p = new FakeProvider([{ text: 'maaf, {"verdict":"maybe"}' }, { text: '{"verdict":"reject","confidence":0.2}' }]);
    const r = await completeJson(p, [{ role: 'user', content: 'x' }], schema);
    expect(r.attempts).toBe(2);
    expect(r.usage.inputTokens).toBe(20);
    const retry = p.calls[1]!.messages;
    expect(retry).toHaveLength(3);
    expect(retry[2]).toMatchObject({ role: 'user' });
    expect((retry[2] as { content: string }).content).toMatch(/HANYA/);
  });

  test('throws LlmOutputError after the second failure so callers can fall back', async () => {
    const p = new FakeProvider([{ text: 'bukan json' }, { text: '{"verdict":"valid"}' }]);
    await expect(completeJson(p, [{ role: 'user', content: 'x' }], schema)).rejects.toBeInstanceOf(LlmOutputError);
  });

  test('a refusal is surfaced as LlmOutputError immediately', async () => {
    const p = new FakeProvider([{ text: '', stopReason: 'refusal' }]);
    await expect(completeJson(p, [{ role: 'user', content: 'x' }], schema)).rejects.toThrow(/refusal/);
    expect(p.calls).toHaveLength(1);
  });
});
