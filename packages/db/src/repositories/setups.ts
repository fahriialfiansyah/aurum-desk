import { SetupSchema, isJournalStatus, isTerminalStatus, type Setup } from '@aurum/shared';
import { desc, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { setups } from '../schema';

const TERMINAL = ['tp2', 'stopped', 'invalidated', 'expired'];
const JOURNAL = ['tp1', 'tp2', 'stopped'];

export async function saveSetup(db: Db, setup: Setup): Promise<void> {
  const closedAt = setup.closedAt ? new Date(setup.closedAt) : isTerminalStatus(setup.status) ? new Date(setup.updatedAt) : null;
  await db
    .insert(setups)
    .values({
      id: setup.id,
      symbol: setup.symbol,
      playbook: setup.playbook,
      direction: setup.direction,
      status: setup.status,
      data: setup,
      createdAt: new Date(setup.createdAt),
      updatedAt: new Date(setup.updatedAt),
      closedAt,
      realizedR: setup.realizedR ?? null,
    })
    .onConflictDoUpdate({
      target: setups.id,
      set: {
        status: setup.status,
        data: setup,
        updatedAt: new Date(setup.updatedAt),
        closedAt,
        realizedR: setup.realizedR ?? null,
      },
    });
}

export async function listActiveSetups(db: Db): Promise<Setup[]> {
  const rows = await db.select({ data: setups.data }).from(setups).where(notInArray(setups.status, TERMINAL)).orderBy(desc(setups.createdAt));
  return rows.map((r) => SetupSchema.parse(r.data));
}

export async function listJournal(db: Db, limit = 500): Promise<Setup[]> {
  const rows = await db
    .select({ data: setups.data })
    .from(setups)
    .where(inArray(setups.status, JOURNAL))
    .orderBy(desc(setups.closedAt))
    .limit(limit);
  return rows.map((r) => SetupSchema.parse(r.data)).filter((s) => isJournalStatus(s.status));
}

export async function countSetupsSince(db: Db, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(setups)
    .where(sql`${setups.createdAt} >= ${since}`);
  return Number(row?.n ?? 0);
}
