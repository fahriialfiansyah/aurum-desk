import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export type DbHandle = {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
};

const DEFAULT_POOL_SIZE = 8;

export function createDb(databaseUrl: string, options: { poolSize?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: options.poolSize ?? DEFAULT_POOL_SIZE });
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}

/** Quick connectivity probe used by tests and health checks. */
export async function pingDb(pool: pg.Pool, timeoutMs = 3000): Promise<boolean> {
  const timer = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const probe = pool
    .query('select 1')
    .then(() => true)
    .catch(() => false);
  return Promise.race([probe, timer]);
}
