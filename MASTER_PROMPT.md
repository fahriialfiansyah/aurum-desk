# MASTER PROMPT — `aurum-desk` (XAUUSD Agent Trading Desk)

> Paste this whole file as the first message of a new Claude Code session opened in
> `/Users/fahrialfiansyah121gmail.com/Documents/projects/aurum-desk`.
> The folder contains only this file; you are building this from scratch.
>
> **Repo name: `aurum-desk`.** Package scope: `@aurum/*`. Display name in the UI header: **Aurum Desk**.

---

## 0. What you are building (one paragraph)

A full-stack, highly interactive web app — a **personal trading desk for XAUUSD (gold) on M1 / M5 / M15 / M30** — with TradingView-style charts, a deterministic strategy engine (market structure + supply/demand + price-action pressure validation), and an **AI agent swarm** that runs on every candle close, draws setups directly on the chart (entry line, SL, TP1 at 1:1.5, TP2 at 1:2), streams its reasoning into a live activity log, and can be chatted with. The visual/interaction benchmark is <https://quant-mesh-live.ebresearch.chatgpt.site/> — a dark, monospace, modular-grid "agent trading desk" with live metrics, an agents panel, a tape, and a scrolling activity log. **Analysis + alerts only. The app never places orders.**

I am the only user. Language of UI copy and agent chat replies: **Bahasa Indonesia** (trading jargon stays in English: BOS, CHoCH, supply/demand, RR, SL/TP).

---

## 1. Decisions already made — do not re-ask these

| Topic | Decision |
|---|---|
| Market data | Pluggable `MarketDataProvider` adapter. **Historical backfill: Dukascopy** (official, free). **Live: Twelve Data** (`XAU/USD`, 1min). Also ship `ReplayProvider` (replays **real** historical candles from Postgres or CSV, with speed control) and `MockProvider` (synthetic ticks). **Mock is for unit tests and explicit dev use only** (`MARKET_DATA_PROVIDER=mock`): never the default, never silently used as a fallback, and the feed-status chip must show a loud "MOCK DATA" badge when active. Replay and live modes always use real market data. Optional `tradingview` adapter is unofficial and off by default (section 5.1). Fetch **M1 only** from providers; **M5/M15/M30 are derived** (Timescale continuous aggregates). |
| Charts | **TradingView Lightweight Charts** (official open-source lib, v5). Not the TradingView embed widget, not scraping TradingView. |
| AI agents | **Swarm + chat.** Specialist agents run automatically on candle close; a chat copilot answers questions and can re-run analysis on demand. |
| Execution | **None.** Analysis, drawings, and alerts only. No broker connection, no order code paths. |
| LLM | **Provider-agnostic** `LLMProvider` interface with implementations for Anthropic, OpenAI, and Ollama (local), selected by `LLM_PROVIDER` env. Deterministic code computes every price level; the LLM only reasons, validates, ranks, and explains. If no LLM key is configured, the app still runs: agents fall back to rule-based explanations and say so. |
| Instrument | XAUUSD only (design the symbol as a config value, but do not build multi-symbol UI). Price precision **0.01**, pip = 0.01, show all prices with 2 decimals. |

If something else is genuinely ambiguous, pick the simplest option, state it in one line, and move on.

---

## 2. Trading logic specification (the core — must be deterministic and unit-tested)

All of this lives in a pure TypeScript package (`packages/engine`, published internally as `@aurum/engine`) with no I/O, so it can be tested with candle fixtures.

### 2.1 Primitives
- **Swing points**: fractal highs/lows with configurable left/right strength (default 3/3 on M15/M30, 2/2 on M5).
- **Market structure**: label swings HH / HL / LH / LL; trend state `bullish | bearish | ranging`; detect **BOS** (break of structure in trend direction, body close beyond swing) and **CHoCH** (first close beyond the last opposing swing — change of character). Keep a list of structural events with candle index + price.
- **Supply/Demand zones**: find **base** (1–4 small-bodied consolidation candles) followed by an **impulsive departure** (≥ N × ATR move, default 1.5× ATR(14) over ≤ 3 candles). Patterns: Rally-Base-Rally, Drop-Base-Drop (continuation), Rally-Base-Drop (supply), Drop-Base-Rally (demand). Zone = base high/low (optionally extended to wick). Track `fresh` (untested) vs `tested` and invalidate when price closes through it. Score zones 0–100 by: departure strength, freshness, confluence with structure (zone at origin of the BOS leg scores highest), time since creation.
- **Buying/selling pressure (price action validation)**: on the entry timeframe, when price enters a zone require at least one of: rejection wick ≥ 50% of range in the trade direction, engulfing candle, pin bar, inside-bar break, or 2+ consecutive closes in direction with expanding bodies. Output a `pressureScore` 0–100 and the list of patterns found.
- **Risk/Reward**: `entry`, `stopLoss` (beyond the zone extreme + buffer = 0.1 × ATR, min 0.30), `tp1 = entry ± 1.5 × risk`, `tp2 = entry ± 2.0 × risk`. All rounded to 0.01.

### 2.2 Playbook A — Intraday: M30 → M15 (user's base prompt, part 1)
1. **Bias on M30**: trend state + last BOS/CHoCH. Only look for longs in bullish structure (or after bullish CHoCH), shorts in bearish.
2. **Zones on M30**, refined on **M15**: pick the highest-scoring fresh zone aligned with bias that price has not yet reached (or is currently in).
3. **Entry marker**: a horizontal line at the zone's proximal edge — **black in light theme, white in dark theme** (this is the user's explicit requirement; the entry line must be theme-aware black/white).
4. **Validation**: setup becomes `valid` only when M15 price enters the zone and pressure patterns confirm. Until then it is `watching`.
5. Output SL, TP1 (1:1.5), TP2 (1:2) and draw them.

### 2.3 Playbook B — Scalping: M15 → M5 (user's base prompt, part 2)
1. **Bias + zones on M15**, **entry on M5** using the same primitives with tighter params.
2. Choose the **single most attractive zone** ("zona paling menarik") by score; show runner-ups as dimmed.
3. Draw the zone as a **black box** (rectangle, black border, 10–15% fill; in dark theme the border is white — same theme-aware rule) and the levels as **black/white lines**. Label every line with its exact price (2 decimals).
4. SL/TP rules identical: 1:1.5 and 1:2.

### 2.4 Setup object (single source of truth, zod schema, persisted)
```ts
type Setup = {
  id: string; playbook: 'intraday_m30_m15' | 'scalp_m15_m5';
  direction: 'long' | 'short'; status: 'watching' | 'valid' | 'triggered' | 'tp1' | 'tp2' | 'stopped' | 'invalidated' | 'expired';
  bias: { tf: 'M30'|'M15'; trend: 'bullish'|'bearish'|'ranging'; lastEvent: 'BOS'|'CHoCH'|null; eventPrice: number };
  zone: { tf: string; type: 'supply'|'demand'; top: number; bottom: number; score: number; fresh: boolean; pattern: 'RBR'|'DBD'|'RBD'|'DBR' };
  entry: number; stopLoss: number; tp1: number; tp2: number; riskPts: number; rr: { tp1: 1.5; tp2: 2 };
  pressure: { score: number; patterns: string[] } | null;
  rationale: { deterministic: string[]; llm?: string };  // llm text is optional
  createdAt: string; updatedAt: string; expiresAt: string;
}
```
Status transitions are driven by the engine on each new candle (touch entry → `triggered`, hit tp1/tp2/sl, zone broken → `invalidated`, no trigger within N candles → `expired`). Keep a journal of closed setups to compute win rate / avg R, shown in the metrics header.

---

## 3. AI agent swarm

Provider-agnostic layer: `packages/llm` (`@aurum/llm`) exposing `LLMProvider { complete(messages, { tools?, jsonSchema?, system }) }` with `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider`. Every agent response is validated with zod; on parse failure retry once, then fall back to deterministic output and log a warning event.

Agents (each a small module in `apps/server/src/agents/`, each emitting typed `AgentEvent`s to the live log):

| Agent | Trigger | Input (from engine, already computed) | Output |
|---|---|---|---|
| **Structure** | M15 & M30 candle close | swings, structure events | bias narrative, confidence |
| **Zones** | M5/M15/M30 close | scored zones | pick + reasoning per playbook |
| **Validator** | price inside an active zone, every M5/M15 close | pressure patterns, candles | `valid`/`reject` + why |
| **Risk** | setup becomes valid | setup | sanity check (RR exactly 1.5/2, SL not inside zone, spread/ATR sanity), position-size suggestion for a user-configured risk % and account size |
| **Copilot (chat)** | user message | tools: `getCandles(tf, n)`, `getStructure(tf)`, `getZones(tf)`, `getSetups()`, `runPlaybook(a|b)`, `drawAnnotation(...)`, `explainSetup(id)` | streamed Indonesian reply; may add/remove chart drawings via tool calls |

Rules: the LLM **never invents a price level** — it can only reference levels returned by tools. Token budget per cycle is capped and visible in the UI ("LLM spend" metric). Everything an agent does appears in the activity log with timestamp, agent name, and a one-line summary (exactly like Quant Mesh's log).

---

## 4. UI / UX (benchmark: Quant Mesh)

Dark theme by default, light theme toggle; monospace numerics (e.g. JetBrains Mono / IBM Plex Mono), dense modular grid, thin 1px borders, muted palette with one accent, up/down colored deltas, symbols like ▲ ▼ ✦. Everything updates live without reload.

Layout (desktop-first, must still be usable at 1280px; collapse to tabs on mobile):

```
┌─ Header metrics: XAUUSD last price ▲/▼ · spread/ATR · session (Asia/London/NY) · setups today · win rate · avg R · LLM spend · data feed status ● ─┐
├─ Left (≈ 70%) ───────────────────────────────┬─ Right (≈ 30%) ──────────────────────────┤
│ Main chart (Lightweight Charts)              │ Agents panel: 5 agents, state, last run   │
│  TF tabs M1 M5 M15 M30 · playbook toggle A/B │ Active setups cards (entry/SL/TP1/TP2,    │
│  overlays: swings, BOS/CHoCH markers,        │   status chip, R progress bar)            │
│  zones (boxes), entry/SL/TP lines w/ price   │ Activity log (streaming, filter by agent) │
│  labels, crosshair, drawing toggle per layer │ Chat copilot (streaming, tool-call chips) │
│ Secondary mini-chart: the "other" TF of the  │ Replay controls when ReplayProvider on:   │
│  active playbook (M15 under M30, M5 under M15)│   ▶ ⏸ speed 1×/5×/20× timeline            │
└──────────────────────────────────────────────┴───────────────────────────────────────────┘
```

Interaction requirements: clicking a setup card focuses/zooms the chart on it; hovering a zone shows its score breakdown; keyboard shortcuts for TF (1/2/3/4) and playbook (A/B); toast + browser Notification + optional Telegram webhook when a setup becomes `valid`, `triggered`, `tp1`, `tp2`, `stopped`. Smooth, purposeful motion (no gratuitous animation).

---

## 5. Architecture & stack

Monorepo (pnpm workspaces + Turborepo), TypeScript everywhere, strict mode.

```
aurum-desk/                  (git repo root, root package name "aurum-desk", private)
  apps/web      Next.js 15 (App Router) + React 19 + Tailwind v4 + Zustand + lightweight-charts v5
  apps/server   Fastify + WebSocket (ws) — engine runner, agent scheduler, REST + WS API (reads candles from Postgres)
  apps/ingest   cron-driven data pipeline — providers → validation → Postgres/Timescale (section 5.1)
  packages/engine   @aurum/engine — pure strategy engine (section 2), zero deps besides zod
  packages/llm      @aurum/llm    — provider-agnostic LLM layer (section 3)
  packages/shared   @aurum/shared — zod schemas + types shared by all apps (Candle, Setup, AgentEvent, WS messages)
  data/             sample XAUUSD M1 CSV for replay + test fixtures
```
- Persistence: **PostgreSQL 16 + TimescaleDB via Drizzle ORM** (candles, setups, journal, agent events, chat history, ingest runs). Runs in Docker Compose; see section 5.1.
### 5.1 Historical data pipeline (`apps/ingest`)

Separate long-running/cron container that only writes candle tables; the engine reads them, the web never touches them directly.

- **Tables**: `candles_m1(symbol, ts timestamptz, open, high, low, close, volume, source)` as a Timescale **hypertable**, PK `(symbol, ts, source)`. **M5/M15/M30 are Timescale continuous aggregates** over M1 — never hand-filled tables — so higher TFs can't drift from M1. `raw_ingest(id, source, fetched_at, payload jsonb)` keeps provider responses verbatim for reprocessing. `ingest_runs(id, source, started, finished, rows_written, status, error)` for observability.
- **Sources** (same `MarketDataProvider` interface, plus a `fetchHistory(from, to)` method):
  - `dukascopy` — **default for historical backfill** (official free tick/bar data; use `dukascopy-node`). Backfill ≥ 2 years of M1 on first run, resumable.
  - `twelvedata` — live incremental M1 (as before).
  - `mt5csv` — import of MetaTrader 5 history export, for broker-exact prices.
  - `tradingview` — **optional, off by default, flagged `unofficial: true`**. Uses the undocumented websocket (as `tvDatafeed` does). Must be isolated in its own adapter, must never be the only source, must degrade gracefully (log + alert, don't crash the ingest service) when the protocol breaks. README states plainly that it violates TradingView ToS and is the user's own risk.
- **Idempotency**: every write is `INSERT … ON CONFLICT (symbol, ts, source) DO UPDATE`. Any run can be re-executed safely.
- **Gap detection**: a job that lists missing M1 timestamps per source against a market calendar (XAUUSD closed Fri 21:00 UTC → Sun 22:00 UTC; weekend gaps are not gaps) and backfills only the missing ranges.
- **Validation** (zod, at the adapter boundary): `low ≤ min(open, close)`, `high ≥ max(open, close)`, `ts` on an exact minute boundary, no future bars, |close − prev close| > 5×ATR flagged in a `anomalies` table rather than dropped.
- **Scheduling**: plain cron in the container (`*/5 * * * *` incremental for live source; `0 2 * * *` daily reconciliation + gap backfill). No Airflow/Prefect — one symbol does not justify it.
- **Alerts**: Telegram message when a run fails or when the newest candle is > 60 min old during market hours.
- **Source selection**: `ENGINE_CANDLE_SOURCE=dukascopy|twelvedata|mt5csv|tradingview` picks which `source` the engine reads; the web shows it in the feed-status chip.

- Realtime: server → web over WebSocket (`candle`, `setup`, `agentEvent`, `chatToken`, `metrics` messages). Web → server REST for commands/chat.
- Config: `.env` validated with zod at startup, fail fast with a readable message. `.env.example` documents `MARKET_DATA_PROVIDER=twelvedata|replay|mock`, `TWELVEDATA_API_KEY`, `LLM_PROVIDER=anthropic|openai|ollama|none`, the three API keys / Ollama URL, `TELEGRAM_BOT_TOKEN`/`CHAT_ID` (optional), `RISK_PERCENT`, `ACCOUNT_SIZE`.
- Timezone: store UTC, display Asia/Jakarta (WIB). Candle close detection must be exact on M1 boundaries; higher TFs close when their last M1 closes.
- Docker Compose for one-command run; also `pnpm dev` runs both apps.

Coding standards (follow my global rules, summarized): immutable data (new objects, no in-place mutation), small files (<400 lines typical), small functions (<50 lines), early returns, named constants for every threshold (ATR multipliers, swing strengths, RR ratios), explicit error handling with user-friendly messages in UI and detailed server logs, zod validation at every boundary (env, provider responses, LLM output, WS messages), no secrets in code, no `console.log` left behind.

Testing: **Vitest**. The engine package is TDD'd and must reach **≥ 80% coverage** with fixture-based tests (hand-built candle series for: HH/HL trend, CHoCH, each of the 4 zone patterns, each pressure pattern, RR math, status transitions). Server gets integration tests for aggregation (M1→M5/M15/M30 boundaries), WS message schemas, and provider adapters with mocked HTTP. Web gets component tests for setup card and chart overlay mapping; one Playwright E2E for "replay runs → setup appears → card click focuses chart → chat asks 'kenapa setup ini valid?' and gets a reply".

---

## 6. How to work (process)

1. **Plan first** (before any code): read this file, then produce a concise phased plan + the directory tree + the engine's public API signatures. Use the planner agent if available. Show it, then **start immediately** — do not wait for approval unless something blocks you.
2. **Research & reuse**: check Lightweight Charts v5 docs for the current API (series API changed in v5: `chart.addSeries(CandlestickSeries, …)`, price lines, custom primitives for rectangles/zones); check Twelve Data `time_series` endpoint and rate limits; check each LLM SDK's current tool-use shape. Prefer well-maintained libs over hand-rolled utilities.
3. **Phases** (commit at the end of each, conventional commits; `git init` first with default branch `main` — do not push anywhere unless I ask):
   - P1 Scaffold monorepo, shared schemas, env validation, Postgres/Timescale in Docker Compose, Drizzle migrations + continuous aggregates, Mock/Replay providers, `apps/ingest` with Dukascopy backfill + idempotent upsert + gap detection (tests).
   - P2 Engine: swings → structure → zones → pressure → RR → setup lifecycle (TDD, ≥80%).
   - P3 Web: layout shell, chart with candles + TF tabs, zone boxes + theme-aware black/white lines with price labels, setup cards, live WS.
   - P4 Agents: LLM layer (3 providers + `none`), 4 specialist agents on candle close, activity log streaming, metrics header.
   - P5 Chat copilot with tools + drawing tool calls; alerts (toast/Notification/Telegram).
   - P6 Twelve Data live provider, MT5 CSV import, optional TradingView adapter (flagged unofficial), replay controls, ingest alerts, README with setup + disclaimer, final review (code-reviewer + security-reviewer agents), E2E.
4. After each phase: run tests, run the app, verify in the browser (screenshot if you can), fix before moving on. Report honestly what works and what doesn't.
5. Keep the README short: how to run with zero keys (mock/replay), how to add Twelve Data + an LLM key, keyboard shortcuts, and a clear **"Bukan saran finansial — alat analisa, bukan eksekusi"** disclaimer.

Definition of done: `pnpm dev` with `MARKET_DATA_PROVIDER=replay` and `LLM_PROVIDER=none` shows the desk replaying gold M1 data, builds M5/M15/M30, draws zones + black/white entry/SL/TP1/TP2 lines with exact prices for both playbooks, streams agent events into the log, updates setup status through to TP/SL, and the chat answers questions about any setup. Switching env to `twelvedata` + a real LLM key requires no code change.
