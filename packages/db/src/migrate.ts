import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { applyTimescale, type TimescaleLogger } from './timescale/apply';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = join(here, '..', 'drizzle');

/** Runs Drizzle SQL migrations, then the Timescale DDL (hypertable + continuous aggregates). */
export async function runMigrations(databaseUrl: string, logger?: TimescaleLogger): Promise<void> {
  const handle = createDb(databaseUrl, { poolSize: 2 });
  try {
    await handle.pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb;');
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger?.info('drizzle migrations applied');
    await applyTimescale(handle.pool, logger);
  } finally {
    await handle.close();
  }
}
