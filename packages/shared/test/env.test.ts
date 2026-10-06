import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { EnvError, envBoolean, envEnum, envInt, envList, envNumber, envString, findDotenv, optionalString, parseEnv } from '../src/env';

describe('parseEnv', () => {
  const schema = z.object({
    PORT: envInt(3000),
    DEBUG: envBoolean(false),
    KEY: optionalString,
    RATIO: envNumber(1.5),
    NAME: envString('x'),
    LEVEL: envEnum(['info', 'debug'], 'info'),
    SOURCES: envList(['dukascopy']),
  });

  test('parses and coerces', () => {
    const env = parseEnv(schema, { PORT: '4000', DEBUG: '1', KEY: '  ', RATIO: '2', NAME: 'srv', LEVEL: 'debug', SOURCES: 'a, b' }, 'test');
    expect(env).toEqual({ PORT: 4000, DEBUG: true, KEY: undefined, RATIO: 2, NAME: 'srv', LEVEL: 'debug', SOURCES: ['a', 'b'] });
  });

  test('blank values fall back to defaults', () => {
    const env = parseEnv(schema, { PORT: '', DEBUG: '', RATIO: '', NAME: '', LEVEL: '', SOURCES: '' }, 'test');
    expect(env).toEqual({ PORT: 3000, DEBUG: false, KEY: undefined, RATIO: 1.5, NAME: 'x', LEVEL: 'info', SOURCES: ['dukascopy'] });
  });

  test('throws a readable EnvError listing every bad key', () => {
    expect(() => parseEnv(schema, { PORT: 'abc', DEBUG: 'maybe' }, 'server')).toThrow(EnvError);
    try {
      parseEnv(schema, { PORT: 'abc', DEBUG: 'maybe' }, 'server');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('[server]');
      expect(message).toContain('PORT');
      expect(message).toContain('DEBUG');
      expect(message).toContain('.env.example');
    }
  });
});

describe('findDotenv', () => {
  test('walks up to find the nearest .env', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurum-env-'));
    writeFileSync(join(root, '.env'), 'A=1\n');
    const nested = join(root, 'apps', 'server');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').mkdirSync(nested, { recursive: true });
    expect(findDotenv(nested)).toBe(join(root, '.env'));
  });

  test('returns null when nothing is found', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurum-noenv-'));
    expect(findDotenv(root)).toBeNull();
  });
});
