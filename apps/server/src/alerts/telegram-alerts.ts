import { PLAYBOOKS, formatPrice, type Setup, type SetupStatus } from '@aurum/shared';
import { sendTelegramMessage } from '@aurum/shared/node';
import type { Logger } from '../logger';

export const ALERT_STATUSES: ReadonlySet<SetupStatus> = new Set(['valid', 'triggered', 'tp1', 'tp2', 'stopped']);

const TITLE: Record<string, string> = {
  valid: '✦ Setup VALID',
  triggered: '▶ Entry tersentuh',
  tp1: '✓ TP1 tercapai',
  tp2: '✓✓ TP2 tercapai',
  stopped: '✕ Stop loss',
};

export function formatAlert(setup: Setup, transition: SetupStatus): string {
  const title = TITLE[transition] ?? transition;
  const r = setup.realizedR !== undefined ? ` · R ${setup.realizedR > 0 ? '+' : ''}${setup.realizedR}` : '';
  return [
    `${title} — ${setup.symbol} ${PLAYBOOKS[setup.playbook].shortLabel} ${setup.direction.toUpperCase()}${r}`,
    `Entry ${formatPrice(setup.entry)} · SL ${formatPrice(setup.stopLoss)}`,
    `TP1 ${formatPrice(setup.tp1)} (1:1.5) · TP2 ${formatPrice(setup.tp2)} (1:2)`,
    `Zona ${setup.zone.type} ${setup.zone.tf} ${formatPrice(setup.zone.bottom)}–${formatPrice(setup.zone.top)} · skor ${setup.zone.score}`,
    'Bukan saran finansial — alat analisa, bukan eksekusi.',
  ].join('\n');
}

export type AlertService = { notify: (setup: Setup, transition: SetupStatus | null) => void; enabled: boolean };

/** Telegram webhook for setup transitions; deduplicates per setup+transition; never throws. */
export function createAlertService(
  config: { botToken?: string; chatId?: string },
  logger: Logger,
  send: typeof sendTelegramMessage = sendTelegramMessage,
): AlertService {
  const token = config.botToken;
  const chatId = config.chatId;
  const sent = new Set<string>();
  if (!token || !chatId) return { enabled: false, notify: () => undefined };
  return {
    enabled: true,
    notify: (setup, transition) => {
      if (!transition || !ALERT_STATUSES.has(transition)) return;
      const key = `${setup.id}:${transition}`;
      if (sent.has(key)) return;
      sent.add(key);
      void send({ botToken: token, chatId }, formatAlert(setup, transition)).then((result) => {
        if (!result.ok) logger.warn({ error: result.error }, 'alert Telegram gagal');
      });
    },
  };
}
