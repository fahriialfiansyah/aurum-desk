import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  if (!pretty) return pino({ level, name: 'ingest' });
  return pino({
    level,
    name: 'ingest',
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
  });
}
