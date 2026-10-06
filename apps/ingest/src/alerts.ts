import { sendTelegramMessage } from '@aurum/shared';
import type { IngestEnv } from './config/env';
import type { Logger } from './logger';

export type Alerter = { notify: (text: string) => Promise<void>; enabled: boolean };

export function createAlerter(env: IngestEnv, logger: Logger): Alerter {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return {
      enabled: false,
      notify: async (text) => {
        logger.warn({ alert: text }, 'ALERT (Telegram tidak dikonfigurasi)');
      },
    };
  }
  return {
    enabled: true,
    notify: async (text) => {
      const result = await sendTelegramMessage({ botToken: token, chatId }, `[aurum-desk ingest] ${text}`);
      if (!result.ok) logger.error({ error: result.error }, 'gagal mengirim alert Telegram');
    },
  };
}
