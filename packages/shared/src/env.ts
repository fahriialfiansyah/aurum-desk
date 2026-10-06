import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

export class EnvError extends Error {
  override readonly name = 'EnvError';
}

/** Parses `source` with `schema`; throws an `EnvError` with a readable, multi-line message on failure. */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, string | undefined>,
  appName: string,
): z.output<TSchema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  • ${key}: ${issue.message}`;
  });
  throw new EnvError(
    `[${appName}] Konfigurasi environment tidak valid:\n${lines.join('\n')}\n  Lihat .env.example untuk referensi.`,
  );
}

const MAX_DOTENV_SEARCH_DEPTH = 5;

/** Finds the nearest `.env` walking up from `startDir` (monorepo-friendly). */
export function findDotenv(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < MAX_DOTENV_SEARCH_DEPTH; depth += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Loads the nearest `.env` into `process.env` without overriding variables that are already set.
 * Returns the path that was loaded, or null when none was found.
 */
export function loadDotenv(startDir: string = process.cwd()): string | null {
  const path = findDotenv(startDir);
  if (!path) return null;
  process.loadEnvFile(path);
  return path;
}

/** Empty strings in `.env` files mean "unset". */
export const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const BOOLEAN_WORDS = ['true', 'false', '1', '0', 'yes', 'no'] as const;

/** Trims strings and turns blanks into `undefined` so `.default()` kicks in. */
const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/** Helpers for env schemas: everything arrives as strings; blanks fall back to the default. */
export const envString = (def: string) => z.preprocess(blankToUndefined, z.string().default(def));
export const envInt = (def: number) => z.preprocess(blankToUndefined, z.coerce.number().int().default(def));
export const envNumber = (def: number) => z.preprocess(blankToUndefined, z.coerce.number().default(def));
export const envBoolean = (def: boolean) =>
  z.preprocess(
    blankToUndefined,
    z
      .enum(BOOLEAN_WORDS)
      .transform((v) => v === 'true' || v === '1' || v === 'yes')
      .default(def),
  );
export const envEnum = <const T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z.preprocess(blankToUndefined, z.enum(values).default(def));
/** Comma-separated list; blank → default list. */
export const envList = (def: readonly string[]) =>
  optionalString.transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [...def]));

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const MAX_ROOT_SEARCH_DEPTH = 6;

/** Nearest ancestor containing pnpm-workspace.yaml, or `startDir` when not inside the monorepo. */
export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (let depth = 0; depth < MAX_ROOT_SEARCH_DEPTH; depth += 1) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/** Relative paths in config (data files, caches) are relative to the repo root, not the package cwd. */
export function resolveFromWorkspaceRoot(path: string, startDir: string = process.cwd()): string {
  return isAbsolute(path) ? path : resolve(findWorkspaceRoot(startDir), path);
}
