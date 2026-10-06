import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  if (!pretty) return pino({ level, name: 'server' });
  return pino({
    level,
    name: 'server',
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
  });
}
