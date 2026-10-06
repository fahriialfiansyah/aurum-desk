import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { OllamaProvider } from '../src/providers/ollama';
import { LlmError } from '../src/types';

function ndjsonResponse(lines: object[], status = 200): Response {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return new Response(body, { status, headers: { 'content-type': 'application/x-ndjson' } });
}

describe('OllamaProvider', () => {
  test('streams text, reports usage, and sends tools + json schema format', async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        { model: 'qwen3:8b', message: { role: 'assistant', content: 'Halo' }, done: false },
        { model: 'qwen3:8b', message: { role: 'assistant', content: ' dunia' }, done: false },
        { model: 'qwen3:8b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 3 },
      ]),
    );
    const tokens: string[] = [];
    const p = new OllamaProvider({ fetchImpl: fetchMock as unknown as typeof fetch });
    const r = await p.complete([{ role: 'user', content: 'hi' }], {
      system: 'sys',
      onToken: (t) => tokens.push(t),
      tools: [{ name: 'getSetups', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      outputSchema: z.object({ a: z.number() }),
    });
    expect(r.text).toBe('Halo dunia');
    expect(tokens).toEqual(['Halo', ' dunia']);
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.tools[0].function.name).toBe('getSetups');
    expect(body.format.type).toBe('object');
  });

  test('maps tool calls (object arguments) and tool results (tool_name)', async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'getZones', arguments: { tf: 'M15' } } }] }, done: true, done_reason: 'stop' }]),
    );
    const p = new OllamaProvider({ fetchImpl: fetchMock as unknown as typeof fetch });
    const r = await p.complete([
      { role: 'user', content: 'zona?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'x', args: {} }] },
      { role: 'tool', toolCallId: 'c1', name: 'x', content: 'ok' },
    ]);
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls).toEqual([{ id: 'call_1', name: 'getZones', args: { tf: 'M15' } }]);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.messages[2]).toEqual({ role: 'tool', content: 'ok', tool_name: 'x' });
  });

  test('network and HTTP errors become LlmError', async () => {
    const down = new OllamaProvider({ fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
    await expect(down.complete([{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(LlmError);
    const bad = new OllamaProvider({ fetchImpl: (async () => new Response('model not found', { status: 404 })) as unknown as typeof fetch });
    await expect(bad.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/404/);
  });
});
