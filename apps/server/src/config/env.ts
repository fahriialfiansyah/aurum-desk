import { HISTORY_SOURCE_NAMES, LIVE_PROVIDER_NAMES } from '@aurum/shared';
import { envEnum, envInt, envNumber, envString, loadDotenv, optionalString, parseEnv } from '@aurum/shared/node';
import { z } from 'zod';

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
export const LLM_PROVIDER_NAMES = ['anthropic', 'openai', 'ollama', 'none'] as const;
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export const serverEnvSchema = z
  .object({
    MARKET_DATA_PROVIDER: envEnum(LIVE_PROVIDER_NAMES, 'replay'),
    TWELVEDATA_API_KEY: optionalString,
    TWELVEDATA_POLL_SECONDS: envInt(15),
    REPLAY_SOURCE: envEnum(['csv', 'postgres'], 'csv'),
    REPLAY_CSV_PATH: envString('./data/xauusd-m1-sample.csv'),
    REPLAY_SPEED: envNumber(20),
    REPLAY_START: optionalString,
    REPLAY_WARMUP_BARS: envInt(3000),
    ENGINE_CANDLE_SOURCE: envEnum(HISTORY_SOURCE_NAMES, 'dukascopy'),
    LLM_PROVIDER: envEnum(LLM_PROVIDER_NAMES, 'none'),
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: envString('claude-opus-5-5'),
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: envString('gpt-5-mini'),
    OLLAMA_BASE_URL: envString('http://localhost:11434'),
    OLLAMA_MODEL: envString('qwen3:8b'),
    LLM_MAX_TOKENS_PER_CYCLE: envInt(6000),
    LLM_DAILY_TOKEN_BUDGET: envInt(400_000),
    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_CHAT_ID: optionalString,
    RISK_PERCENT: envNumber(1),
    ACCOUNT_SIZE: envNumber(10_000),
    DATABASE_URL: z.url({ message: 'DATABASE_URL harus berupa URL postgres://…' }),
    SERVER_PORT: envInt(4000),
    SERVER_HOST: envString('0.0.0.0'),
    WEB_ORIGIN: envString('http://localhost:3000'),
    /** Optional shared secret; when set, POST /api/* and /ws require `Authorization: Bearer <token>` (or ?token=). */
    SERVER_API_TOKEN: optionalString,
    /** POST requests per minute per client IP (chat, playbook runs, replay controls). */
    API_RATE_LIMIT_PER_MINUTE: envInt(60),
    SYMBOL: envString('XAUUSD'),
    LOG_LEVEL: envEnum(LOG_LEVELS, 'info'),
    NODE_ENV: envString('development'),
  })
  .superRefine((env, ctx) => {
    if (env.MARKET_DATA_PROVIDER === 'twelvedata' && !env.TWELVEDATA_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['TWELVEDATA_API_KEY'], message: 'wajib diisi saat MARKET_DATA_PROVIDER=twelvedata' });
    }
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'wajib diisi saat LLM_PROVIDER=anthropic' });
    }
    if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'wajib diisi saat LLM_PROVIDER=openai' });
    }
    if (env.REPLAY_SPEED <= 0) {
      ctx.addIssue({ code: 'custom', path: ['REPLAY_SPEED'], message: 'harus > 0' });
    }
    if (env.RISK_PERCENT <= 0 || env.RISK_PERCENT > 10) {
      ctx.addIssue({ code: 'custom', path: ['RISK_PERCENT'], message: 'harus di antara 0 dan 10' });
    }
  });

export type ServerEnv = z.output<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  loadDotenv();
  return parseEnv(serverEnvSchema, source, 'server');
}
