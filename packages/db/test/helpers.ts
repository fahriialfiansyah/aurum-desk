import { createDb, pingDb, type DbHandle } from '../src/client';
import { runMigrations } from '../src/migrate';

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://aurum:aurum@localhost:5432/aurum';

/** Returns a handle when Postgres is reachable, otherwise null so suites can skip. */
export async function connectForTests(): Promise<DbHandle | null> {
  const handle = createDb(TEST_DATABASE_URL, { poolSize: 2 });
  const ok = await pingDb(handle.pool);
  if (!ok) {
    await handle.close();
    return null;
  }
  await runMigrations(TEST_DATABASE_URL);
  return handle;
}
