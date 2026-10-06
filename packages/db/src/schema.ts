import {
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const tsCol = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * M1 candles — a TimescaleDB hypertable (created by src/timescale after the Drizzle migration).
 * M5/M15/M30 are continuous aggregates over this table, never hand-filled.
 */
export const candlesM1 = pgTable(
  'candles_m1',
  {
    symbol: text('symbol').notNull(),
    ts: tsCol('ts').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: doublePrecision('volume').notNull().default(0),
    source: text('source').notNull(),
  },
  (t) => [
    primaryKey({ name: 'candles_m1_pk', columns: [t.symbol, t.ts, t.source] }),
    index('candles_m1_symbol_source_ts_idx').on(t.symbol, t.source, t.ts),
  ],
);

/** Provider responses kept verbatim so any range can be reprocessed. */
export const rawIngest = pgTable(
  'raw_ingest',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').notNull(),
    fetchedAt: tsCol('fetched_at').notNull().defaultNow(),
    rangeFrom: tsCol('range_from').notNull(),
    rangeTo: tsCol('range_to').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('raw_ingest_source_fetched_idx').on(t.source, t.fetchedAt)],
);

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').notNull(),
    kind: text('kind').notNull(), // backfill | incremental | gaps | import | reconcile
    started: tsCol('started').notNull().defaultNow(),
    finished: tsCol('finished'),
    rowsWritten: integer('rows_written').notNull().default(0),
    status: text('status').notNull().default('running'), // running | ok | failed
    error: text('error'),
    meta: jsonb('meta'),
  },
  (t) => [index('ingest_runs_source_started_idx').on(t.source, t.started)],
);

/** Suspicious bars are flagged here instead of being dropped. */
export const anomalies = pgTable(
  'anomalies',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    symbol: text('symbol').notNull(),
    source: text('source').notNull(),
    ts: tsCol('ts').notNull(),
    kind: text('kind').notNull(), // price_jump | duplicate | out_of_order | ...
    detail: jsonb('detail'),
    createdAt: tsCol('created_at').notNull().defaultNow(),
  },
  (t) => [index('anomalies_symbol_ts_idx').on(t.symbol, t.ts)],
);

/** Every setup ever produced; closed ones form the journal. The `data` column holds the full zod Setup. */
export const setups = pgTable(
  'setups',
  {
    id: text('id').primaryKey(),
    symbol: text('symbol').notNull(),
    playbook: text('playbook').notNull(),
    direction: text('direction').notNull(),
    status: text('status').notNull(),
    data: jsonb('data').notNull(),
    createdAt: tsCol('created_at').notNull(),
    updatedAt: tsCol('updated_at').notNull(),
    closedAt: tsCol('closed_at'),
    realizedR: doublePrecision('realized_r'),
  },
  (t) => [index('setups_status_idx').on(t.status), index('setups_created_idx').on(t.createdAt)],
);

export const agentEvents = pgTable(
  'agent_events',
  {
    id: text('id').primaryKey(),
    ts: tsCol('ts').notNull(),
    agent: text('agent').notNull(),
    level: text('level').notNull(),
    summary: text('summary').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [index('agent_events_ts_idx').on(t.ts)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    ts: tsCol('ts').notNull(),
    data: jsonb('data'),
  },
  (t) => [index('chat_messages_conversation_ts_idx').on(t.conversationId, t.ts)],
);
