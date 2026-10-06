# aurum-desk

Personal XAUUSD (gold) agent trading desk — M1/M5/M15/M30 charts, deterministic market-structure +
supply/demand engine, and an AI agent swarm that draws setups and explains them in Bahasa Indonesia.

> **Bukan saran finansial — alat analisa, bukan eksekusi.** Aplikasi ini tidak pernah mengirim order.

Work in progress — see [docs/PLAN.md](docs/PLAN.md) for the phased plan and [MASTER_PROMPT.md](MASTER_PROMPT.md)
for the full specification. The README is completed in the final phase.

## Quick start (zero API keys, real replay data)

```bash
corepack enable && pnpm install
cp .env.example .env
pnpm db:up && pnpm db:migrate
pnpm dev            # server :4000 + web :3000 (from phase P3 on)
```

Historical data lives in Postgres/TimescaleDB and is written only by `apps/ingest`:

```bash
pnpm ingest backfill --from 2024-01-01      # Dukascopy, resumable, idempotent
pnpm ingest gaps --days 30                  # report missing market-hours minutes
pnpm ingest serve                           # cron: incremental */5, reconcile daily
```
