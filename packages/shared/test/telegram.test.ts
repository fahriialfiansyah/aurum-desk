import { describe, expect, test, vi } from 'vitest';
import { sendTelegramMessage } from '../src/telegram';

const cfg = { botToken: 'T', chatId: '42' };

describe('sendTelegramMessage', () => {
  test('posts JSON to the bot endpoint and reports ok', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
    const result = await sendTelegramMessage(cfg, 'halo', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: '42', text: 'halo' });
  });

  test('surfaces API errors without throwing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }), { status: 401 }));
    const result = await sendTelegramMessage(cfg, 'x', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: 'Unauthorized' });
  });

  test('surfaces network failures without throwing', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const result = await sendTelegramMessage(cfg, 'x', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: 'ECONNRESET' });
  });
});
