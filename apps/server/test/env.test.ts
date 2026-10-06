import { describe, expect, test } from 'vitest';
import { serverEnvSchema } from '../src/config/env';

const base = { DATABASE_URL: 'postgres://aurum:aurum@localhost:5432/aurum' };

describe('serverEnvSchema', () => {
  test('defaults to replay + no LLM with zero keys', () => {
    const env = serverEnvSchema.parse(base);
    expect(env.MARKET_DATA_PROVIDER).toBe('replay');
    expect(env.LLM_PROVIDER).toBe('none');
    expect(env.REPLAY_SPEED).toBe(20);
    expect(env.SERVER_PORT).toBe(4000);
  });

  test('twelvedata requires an API key', () => {
    const result = serverEnvSchema.safeParse({ ...base, MARKET_DATA_PROVIDER: 'twelvedata' });
    expect(result.success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, MARKET_DATA_PROVIDER: 'twelvedata', TWELVEDATA_API_KEY: 'k' }).success).toBe(true);
  });

  test('LLM providers require their keys; ollama and none do not', () => {
    expect(serverEnvSchema.safeParse({ ...base, LLM_PROVIDER: 'anthropic' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, LLM_PROVIDER: 'openai' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, LLM_PROVIDER: 'ollama' }).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...base, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk' }).success).toBe(true);
  });

  test('rejects an invalid database url and a bad risk percent', () => {
    expect(serverEnvSchema.safeParse({ DATABASE_URL: 'nope' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, RISK_PERCENT: '50' }).success).toBe(false);
  });

  test('mock is never selected implicitly', () => {
    expect(serverEnvSchema.parse({ ...base, MARKET_DATA_PROVIDER: '' }).MARKET_DATA_PROVIDER).toBe('replay');
  });
});
