import type OpenAI from 'openai';
import { describe, expect, test, vi } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai';

describe('OpenAIProvider', () => {
  test('non-streaming: maps tool calls and usage', async () => {
    const create = vi.fn(async () => ({
      model: 'gpt-5-mini',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'getZones', arguments: '{"tf":"M5"}' } }] },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    }));
    const client = { chat: { completions: { create } } } as unknown as Pick<OpenAI, 'chat'>;
    const p = new OpenAIProvider({ client });
    const r = await p.complete([{ role: 'user', content: 'x' }, { role: 'tool', toolCallId: 'c0', name: 'n', content: 'r' }], { system: 'sys' });
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'getZones', args: { tf: 'M5' } }]);
    expect(r.stopReason).toBe('tool_use');
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 4 });
    const params = (create.mock.calls[0] as unknown as [OpenAI.ChatCompletionCreateParams])[0];
    expect(params.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(params.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c0', content: 'r' });
  });

  test('streaming: accumulates deltas, tool-call fragments and the usage chunk', async () => {
    async function* chunks() {
      yield { model: 'gpt-5-mini', choices: [{ delta: { content: 'Ha' } }] };
      yield { model: 'gpt-5-mini', choices: [{ delta: { content: 'lo', tool_calls: [{ index: 0, id: 'c9', function: { name: 'get', arguments: '{"a":' } }] } }] };
      yield { model: 'gpt-5-mini', choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'Zones', arguments: '1}' } }] }, finish_reason: 'tool_calls' }] };
      yield { model: 'gpt-5-mini', choices: [], usage: { prompt_tokens: 5, completion_tokens: 6 } };
    }
    const client = { chat: { completions: { create: vi.fn(async () => chunks()) } } } as unknown as Pick<OpenAI, 'chat'>;
    const tokens: string[] = [];
    const r = await new OpenAIProvider({ client }).complete([{ role: 'user', content: 'x' }], { onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual(['Ha', 'lo']);
    expect(r.text).toBe('Halo');
    expect(r.toolCalls).toEqual([{ id: 'c9', name: 'getZones', args: { a: 1 } }]);
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 6 });
    expect(r.stopReason).toBe('tool_use');
  });
});
