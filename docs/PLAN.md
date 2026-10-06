# aurum-desk — Implementation Plan

Source of truth: [MASTER_PROMPT.md](../MASTER_PROMPT.md). This file is the concise working plan.

## Decisions made while planning (simplest option, stated once)

- Repo root is this folder (`projects/aurum-desk`).
- Added a 4th package, `packages/db` (`@aurum/db`): Drizzle schema + migrations + Timescale DDL shared by `apps/server` and `apps/ingest`. The web never imports it.
- Workspace packages export TypeScript source (`"main": "./src/index.ts"`). Server/ingest run with `tsx`, web uses `transpilePackages`. No per-package build step.
- Toolchain: Node 20, pnpm 12, TypeScript 5.9 (not the 7.x preview), Vitest 4 (Node 20 compatible), Next 15.5, React 19, Tailwind 4, lightweight-charts 5.2, Drizzle 0.45, Fastify 5, Zod 4.
- Prices: stored at source precision (Dukascopy quotes XAUUSD to 0.001). Every level the engine computes is rounded to 0.01; UI shows 2 decimals.
- Candle `time` is the bar **open** time in unix seconds UTC everywhere (engine, WS, charts). Postgres `ts` is the same instant as `timestamptz`.

## Phases

| Phase | Deliverable | Verify |
|---|---|---|
| P1 | Monorepo scaffold, `@aurum/shared` schemas, env validation, Docker Compose (Timescale), `@aurum/db` migrations + hypertable + continuous aggregates, Mock/Replay providers, `apps/ingest` (Dukascopy backfill, idempotent upsert, gap detection, cron) | `pnpm test` (shared, db, ingest), `docker compose up db`, real backfill of ≥ 1 month, caggs populated |
| P2 | `@aurum/engine`: ATR, swings, structure (HH/HL/LH/LL, BOS, CHoCH), S/D zones (RBR/DBD/RBD/DBR, scoring), pressure patterns, RR levels, playbooks A/B, setup lifecycle | TDD fixtures, coverage ≥ 80% |
| P3 | `apps/server` runner + WS/REST; `apps/web` desk shell, main + mini chart, TF tabs, zones as boxes, theme-aware black/white entry/SL/TP lines with price labels, setup cards, live WS | replay in browser, screenshot |
| P4 | `@aurum/llm` (Anthropic/OpenAI/Ollama/none), Structure/Zones/Validator/Risk agents on candle close, activity log, metrics header (LLM spend) | agents stream events with `LLM_PROVIDER=none` |
| P5 | Chat copilot with tools + drawing tool-calls; alerts (toast, Notification, Telegram) | "kenapa setup ini valid?" answered |
| P6 | Twelve Data live, MT5 CSV import, optional TradingView adapter (unofficial, off), replay controls, ingest alerts, README, code+security review, Playwright E2E | definition of done |

Commit at the end of each phase (conventional commits), branch `main`, no remote.

## Directory tree

```
aurum-desk/
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  .env.example  docker-compose.yml
  MASTER_PROMPT.md  README.md  docs/PLAN.md
  data/
    xauusd-m1-sample.csv              real Dukascopy M1 bars for replay (no mock)
    fixtures/                         hand-built candle fixtures for engine tests
  packages/
    shared/   @aurum/shared           zod schemas + types: Candle, Timeframe, Setup, Zone, AgentEvent, WS messages, env
    engine/   @aurum/engine           pure strategy engine (no I/O); deps: zod + @aurum/shared
    llm/      @aurum/llm              LLMProvider interface + Anthropic/OpenAI/Ollama/None, token accounting
    db/       @aurum/db               Drizzle schema, migrations, Timescale DDL, repositories
  apps/
    ingest/   @aurum/ingest           providers (dukascopy, twelvedata, mt5csv, tradingview*), validation, upsert, gaps, cron, alerts
    server/   @aurum/server           Fastify REST + WS, market feed (replay/twelvedata/mock), aggregator, engine runner, agents, chat, alerts
    web/      @aurum/web              Next.js 15 desk UI (lightweight-charts v5, Zustand, Tailwind 4)
```

## Engine public API (`@aurum/engine`)

```ts
// candles & indicators
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30';
export const TIMEFRAME_SECONDS: Record<Timeframe, number>;
export function bucketStart(timeSec: number, tf: Timeframe): number;
export function aggregateCandles(m1: readonly Candle[], tf: Timeframe): Candle[];           // closed buckets only + forming last
export function atr(candles: readonly Candle[], period?: number): number[];                   // Wilder, NaN during warm-up
export function roundPrice(value: number): number;                                            // 0.01 precision

// swings
export type SwingPoint = { index: number; time: number; price: number; kind: 'high' | 'low' };
export type SwingParams = { left: number; right: number };
export function detectSwings(candles: readonly Candle[], params: SwingParams): SwingPoint[];

// market structure
export type TrendState = 'bullish' | 'bearish' | 'ranging';
export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL';
export type LabeledSwing = SwingPoint & { label: SwingLabel | null };
export type StructureEvent = { kind: 'BOS' | 'CHoCH'; direction: 'bullish' | 'bearish'; index: number; time: number; price: number; brokenSwing: SwingPoint };
export type MarketStructure = { trend: TrendState; swings: LabeledSwing[]; events: StructureEvent[]; lastEvent: StructureEvent | null };
export function analyzeStructure(candles: readonly Candle[], swings: readonly SwingPoint[]): MarketStructure;

// supply / demand zones
export type ZonePattern = 'RBR' | 'DBD' | 'RBD' | 'DBR';
export type Zone = { id: string; tf: Timeframe; type: 'supply' | 'demand'; pattern: ZonePattern; top: number; bottom: number;
  baseStart: number; baseEnd: number; departureEnd: number; createdAt: number; fresh: boolean; tested: boolean; invalidated: boolean;
  score: number; scoreBreakdown: { departure: number; freshness: number; structure: number; age: number } };
export type ZoneParams = { maxBaseCandles: number; departureAtrMultiple: number; departureMaxCandles: number; baseBodyMaxAtr: number; useWicks: boolean };
export function detectZones(candles: readonly Candle[], atrValues: readonly number[], structure: MarketStructure, tf: Timeframe, params: ZoneParams): Zone[];
export function updateZoneStates(zones: readonly Zone[], candles: readonly Candle[], fromIndex: number): Zone[];  // fresh/tested/invalidated
export function scoreZone(zone: Zone, ctx: { atr: number; structure: MarketStructure; nowIndex: number }): Zone;

// buying / selling pressure (price-action validation)
export type PressurePattern = 'rejection_wick' | 'engulfing' | 'pin_bar' | 'inside_bar_break' | 'consecutive_expansion';
export type PressureResult = { score: number; patterns: PressurePattern[] };
export function evaluatePressure(candles: readonly Candle[], zone: Zone, direction: 'long' | 'short', params?: PressureParams): PressureResult;

// risk / reward
export type Levels = { entry: number; stopLoss: number; tp1: number; tp2: number; riskPts: number };
export function computeLevels(args: { direction: 'long' | 'short'; zone: Zone; atr: number }): Levels;  // SL = zone extreme + max(0.1×ATR, 0.30); TP1 = 1.5R; TP2 = 2R

// playbooks
export type PlaybookId = 'intraday_m30_m15' | 'scalp_m15_m5';
export type PlaybookInput = { higher: readonly Candle[]; lower: readonly Candle[]; now: number; existing: readonly Setup[] };
export type PlaybookResult = { bias: Bias; zones: Zone[]; best: Setup | null; runnerUps: Zone[]; structure: { higher: MarketStructure; lower: MarketStructure } };
export function runPlaybook(id: PlaybookId, input: PlaybookInput, params?: Partial<EngineParams>): PlaybookResult;

// setup lifecycle (pure state machine)
export function advanceSetup(setup: Setup, candle: Candle, nowIndex: number, params?: LifecycleParams): { setup: Setup; transition: SetupStatus | null };
export function journalStats(closed: readonly Setup[]): { winRate: number; avgR: number; count: number };
export const DEFAULT_PARAMS: EngineParams;   // every threshold named here
```
