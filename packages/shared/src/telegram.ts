import { z } from 'zod';

const TELEGRAM_API = 'https://api.telegram.org';
const TELEGRAM_MAX_TEXT = 4096;

const responseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  error_code: z.number().optional(),
});

export type TelegramConfig = { botToken: string; chatId: string };

export type TelegramResult = { ok: true } | { ok: false; error: string };

/** Sends a plain-text Telegram message. Never throws; returns a result the caller can log. */
export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramResult> {
  const body = {
    chat_id: config.chatId,
    text: text.slice(0, TELEGRAM_MAX_TEXT),
    disable_web_page_preview: true,
  };
  try {
    const res = await fetchImpl(`${TELEGRAM_API}/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = responseSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, error: `unexpected Telegram response (HTTP ${res.status})` };
    if (!parsed.data.ok) return { ok: false, error: parsed.data.description ?? `Telegram error ${parsed.data.error_code ?? res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
