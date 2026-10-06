import {
  createDb,
  listActiveSetups,
  listJournal,
  listRecentAgentEvents,
  pingDb,
  saveAgentEvent,
  saveChatMessage,
  saveSetup,
  type Db,
  type DbHandle,
} from '@aurum/db';
import type { AgentEvent, ChatMessage, Setup } from '@aurum/shared';
import type { Logger } from '../logger';

/**
 * Optional Postgres persistence. When the database is unreachable the desk still runs
 * (replay from CSV) in memory-only mode and says so loudly in the log and feed status.
 */
export type Persistence = {
  readonly mode: 'postgres' | 'memory';
  readonly db: Db | null;
  loadSetups(): Promise<{ active: Setup[]; journal: Setup[] }>;
  loadEvents(limit: number): Promise<AgentEvent[]>;
  saveSetup(setup: Setup): Promise<void>;
  saveEvent(event: AgentEvent): Promise<void>;
  saveChat(conversationId: string, message: ChatMessage): Promise<void>;
  close(): Promise<void>;
};

const memory: Persistence = {
  mode: 'memory',
  db: null,
  loadSetups: async () => ({ active: [], journal: [] }),
  loadEvents: async () => [],
  saveSetup: async () => undefined,
  saveEvent: async () => undefined,
  saveChat: async () => undefined,
  close: async () => undefined,
};

export async function createPersistence(databaseUrl: string, logger: Logger): Promise<Persistence> {
  const handle: DbHandle = createDb(databaseUrl, { poolSize: 4 });
  const reachable = await pingDb(handle.pool);
  if (!reachable) {
    await handle.close();
    logger.warn('Database tidak terjangkau — berjalan dalam mode memory-only (setup & log tidak disimpan). Jalankan `pnpm db:up && pnpm db:migrate`.');
    return memory;
  }
  const guard = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, `gagal menyimpan ${label}`);
    }
  };
  return {
    mode: 'postgres',
    db: handle.db,
    loadSetups: async () => ({ active: await listActiveSetups(handle.db), journal: await listJournal(handle.db) }),
    loadEvents: (limit) => listRecentAgentEvents(handle.db, limit),
    saveSetup: (setup) => guard('setup', () => saveSetup(handle.db, setup)),
    saveEvent: (event) => guard('event', () => saveAgentEvent(handle.db, event)),
    saveChat: (conversationId, message) => guard('chat', () => saveChatMessage(handle.db, conversationId, message)),
    close: () => handle.close(),
  };
}

export const memoryPersistence = memory;
