import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from '../src/providers/anthropic';

function fakeMessage(content: Anthropic.ContentBlock[], stop: Anthropic.Message['stop_reason'] = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 42, output_tokens: 7 } as Anthropic.Usage,
  } as Anthropic.Message;
}

describe('AnthropicProvider', () => {
  test('maps messages, system (cached), tools and structured output; parses text + tool_use blocks', async () => {
    const create = vi.fn(async () =>
      fakeMessage([
        { type: 'text', text: 'Bias bullish.', citations: null } as Anthropic.TextBlock,
        { type: 'tool_use', id: 'tu_1', name: 'getZones', input: { tf: 'M15' } } as Anthropic.ToolUseBlock,
      ], 'tool_use'),
    );
    const client = { messages: { create, stream: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    const p = new AnthropicProvider({ client, model: 'claude-opus-5-5' });
    const r = await p.complete(
      [
        { role: 'user', content: 'halo' },
        { role: 'assistant', content: 'ok', toolCalls: [{ id: 'tu_0', name: 'getSetups', args: {} }] },
        { role: 'tool', toolCallId: 'tu_0', name: 'getSetups', content: '[]' },
        { role: 'tool', toolCallId: 'tu_0b', name: 'getSetups', content: '[]' },
      ],
      { system: 'sys', tools: [{ name: 'getZones', description: 'd', inputSchema: { type: 'object', properties: {} } }], outputSchema: z.object({ a: z.string() }), effort: 'medium' },
    );
    expect(r.text).toBe('Bias bullish.');
    expect(r.toolCalls).toEqual([{ id: 'tu_1', name: 'getZones', args: { tf: 'M15' } }]);
    expect(r.stopReason).toBe('tool_use');
    expect(r.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    const params = (create.mock.calls[0] as unknown as [Anthropic.MessageCreateParams])[0];
    expect(params.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
    expect(params.output_config?.effort).toBe('medium');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(params.tools?.[0]).toMatchObject({ name: 'getZones' });
    // two consecutive tool results share one user message
    const msgs = params.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[2]?.role).toBe('user');
    expect((msgs[2]?.content as unknown[]).length).toBe(2);
  });

  test('streams text through onToken and uses finalMessage()', async () => {
    const listeners: Record<string, (t: string) => void> = {};
    const streamObj = {
      on: (ev: string, cb: (t: string) => void) => {
        listeners[ev] = cb;
        return streamObj;
      },
      finalMessage: async () => {
        listeners.text?.('Ha');
        listeners.text?.('lo');
        return fakeMessage([{ type: 'text', text: 'Halo', citations: null } as Anthropic.TextBlock]);
      },
    };
    const client = { messages: { create: vi.fn(), stream: vi.fn(() => streamObj) } } as unknown as Pick<Anthropic, 'messages'>;
    const p = new AnthropicProvider({ client });
    const tokens: string[] = [];
    const r = await p.complete([{ role: 'user', content: 'x' }], { onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual(['Ha', 'lo']);
    expect(r.text).toBe('Halo');
    expect(p.model).toBe('claude-opus-5-5');
  });

  test('refusal stop reason is propagated', async () => {
    const client = { messages: { create: vi.fn(async () => fakeMessage([], 'refusal')), stream: vi.fn() } } as unknown as Pick<Anthropic, 'messages'>;
    const r = await new AnthropicProvider({ client }).complete([{ role: 'user', content: 'x' }]);
    expect(r.stopReason).toBe('refusal');
  });
});
