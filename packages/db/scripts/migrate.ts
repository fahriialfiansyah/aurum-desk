import { loadDotenv } from '@aurum/shared';
import { runMigrations } from '../src/migrate';

loadDotenv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

runMigrations(url, { info: (m) => console.log(`[db] ${m}`), warn: (m) => console.warn(`[db] ${m}`) })
  .then(() => {
    console.log('[db] migrations complete');
  })
  .catch((error: unknown) => {
    console.error('[db] migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
