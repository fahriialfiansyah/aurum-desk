import type { LlmToolDef } from '@aurum/llm';
import {
  DrawingSchema,
  PLAYBOOKS,
  PlaybookIdSchema,
  TimeframeSchema,
  formatPrice,
  formatWib,
  newId,
  type Drawing,
  type Metrics,
  type Setup,
} from '@aurum/shared';
import { z } from 'zod';
import type { EngineRunner, RunnerEvent } from '../engine/runner';
import type { MarketFeed } from '../market/feed';
import type { SetupStore } from '../state/setup-store';
import type { DrawingStore } from './drawings';

export type ToolDeps = {
  feed: MarketFeed;
  runner: EngineRunner;
  setups: SetupStore;
  drawings: DrawingStore;
  metrics: () => Metrics;
  onRunnerEvents: (events: RunnerEvent[]) => void;
  onDrawing: (action: 'add' | 'remove' | 'clear', drawing?: Drawing, drawingId?: string) => void;
};

export type ToolResult = { content: string; summary: string };
export type CopilotTool = { def: LlmToolDef; run: (args: unknown) => Promise<ToolResult> };

export class ToolError extends Error {
  override readonly name = 'ToolError';
}

const MAX_CANDLES = 200;
const LEVEL_TOLERANCE = 0.011;

function schemaToJson(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function compactSetup(s: Setup) {
  return {
    id: s.id,
    playbook: `${PLAYBOOKS[s.playbook].shortLabel} ${PLAYBOOKS[s.playbook].biasTf}→${PLAYBOOKS[s.playbook].entryTf}`,
    direction: s.direction,
    status: s.status,
    zone: s.zone,
    entry: s.entry,
    stopLoss: s.stopLoss,
    tp1: s.tp1,
    tp2: s.tp2,
    riskPts: s.riskPts,
    pressure: s.pressure,
    rationale: s.rationale,
    createdAt: s.createdAt,
    realizedR: s.realizedR,
  };
}

/** Every price the copilot may reference when drawing: zone edges, levels, structure prices. */
export function knownLevels(deps: Pick<ToolDeps, 'runner' | 'setups'>): number[] {
  const levels = new Set<number>();
  for (const snap of deps.runner.analyses()) {
    for (const z of snap.zones) {
      levels.add(z.top);
      levels.add(z.bottom);
    }
    for (const e of snap.structure.events) levels.add(e.price);
    for (const s of snap.structure.swings) levels.add(s.price);
  }
  for (const s of deps.setups.all()) {
    for (const v of [s.entry, s.stopLoss, s.tp1, s.tp2, s.zone.top, s.zone.bottom]) levels.add(v);
  }
  return [...levels];
}

function assertKnownLevel(price: number, levels: number[], label: string): void {
  if (!levels.some((l) => Math.abs(l - price) <= LEVEL_TOLERANCE)) {
    throw new ToolError(`${label} ${formatPrice(price)} bukan level yang dikenal engine. Gunakan harga dari getZones/getSetups/getStructure.`);
  }
}

export function buildTools(deps: ToolDeps): CopilotTool[] {
  const candlesArgs = z.object({ tf: TimeframeSchema, n: z.number().int().min(1).max(MAX_CANDLES).default(50) });
  const tfArgs = z.object({ tf: TimeframeSchema });
  const idArgs = z.object({ id: z.string().min(1) });
  const playbookArgs = z.object({ playbook: PlaybookIdSchema });
  const drawArgs = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('hline'), price: z.number(), label: z.string().max(60).optional(), tf: TimeframeSchema.optional(), style: z.enum(['solid', 'dashed', 'dotted']).optional() }),
    z.object({ kind: z.literal('box'), top: z.number(), bottom: z.number(), fromTime: z.number().int().optional(), label: z.string().max(60).optional(), tf: TimeframeSchema.optional() }),
    z.object({ kind: z.literal('marker'), time: z.number().int(), position: z.enum(['above', 'below']), text: z.string().max(30), tf: TimeframeSchema.optional() }),
  ]);
  const removeArgs = z.object({ id: z.string().min(1).optional(), all: z.boolean().optional() });

  return [
    {
      def: { name: 'getCandles', description: 'Candle OHLC terakhir (closed) untuk timeframe M1/M5/M15/M30. n maks 200.', inputSchema: schemaToJson(candlesArgs) },
      run: async (raw) => {
        const { tf, n } = candlesArgs.parse(raw);
        const candles = deps.feed.closedCandles(tf, n).map((c) => ({ t: formatWib(c.time), o: c.open, h: c.high, l: c.low, c: c.close }));
        return { content: JSON.stringify({ tf, count: candles.length, candles }), summary: `${candles.length} candle ${tf}` };
      },
    },
    {
      def: { name: 'getStructure', description: 'Struktur pasar untuk timeframe: trend, BOS/CHoCH terakhir, swing HH/HL/LH/LL, ATR.', inputSchema: schemaToJson(tfArgs) },
      run: async (raw) => {
        const { tf } = tfArgs.parse(raw);
        const snap = deps.runner.analysis(tf);
        if (!snap) throw new ToolError(`Analisa ${tf} belum tersedia (menunggu candle close pertama).`);
        const s = snap.structure;
        const content = JSON.stringify({
          tf,
          trend: s.trend,
          atr: snap.atr,
          lastEvent: s.lastEvent ? { kind: s.lastEvent.kind, direction: s.lastEvent.direction, price: s.lastEvent.price, time: formatWib(s.lastEvent.time) } : null,
          events: s.events.slice(-6).map((e) => ({ kind: e.kind, direction: e.direction, price: e.price, time: formatWib(e.time) })),
          swings: s.swings.slice(-10).map((w) => ({ label: w.label, kind: w.kind, price: w.price, time: formatWib(w.time) })),
          computedAt: snap.computedAt,
        });
        return { content, summary: `${tf} ${s.trend}` };
      },
    },
    {
      def: { name: 'getZones', description: 'Zona supply/demand (skor 0–100, fresh/tested) untuk timeframe.', inputSchema: schemaToJson(tfArgs) },
      run: async (raw) => {
        const { tf } = tfArgs.parse(raw);
        const snap = deps.runner.analysis(tf);
        if (!snap) throw new ToolError(`Analisa ${tf} belum tersedia.`);
        const price = deps.feed.lastPrice();
        const zones = snap.zones.map((z) => ({
          id: z.id,
          type: z.type,
          pattern: z.pattern,
          top: z.top,
          bottom: z.bottom,
          score: z.score,
          breakdown: z.scoreBreakdown,
          fresh: z.fresh,
          tested: z.tested,
          touches: z.touches,
          distanceFromPrice: price === null ? null : Math.round((price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0) * 100) / 100,
          createdAt: formatWib(z.createdAt),
        }));
        return { content: JSON.stringify({ tf, price, zones }), summary: `${zones.length} zona ${tf}` };
      },
    },
    {
      def: { name: 'getSetups', description: 'Setup aktif dan jurnal terakhir (entry, SL, TP1, TP2, status, pressure, rationale).', inputSchema: schemaToJson(z.object({})) },
      run: async () => {
        const active = deps.setups.active.map(compactSetup);
        const journal = deps.setups.journal.slice(0, 10).map(compactSetup);
        return { content: JSON.stringify({ active, journal }), summary: `${active.length} aktif, ${journal.length} jurnal` };
      },
    },
    {
      def: { name: 'explainSetup', description: 'Detail satu setup beserta alasan deterministik engine dan catatan agen.', inputSchema: schemaToJson(idArgs) },
      run: async (raw) => {
        const { id } = idArgs.parse(raw);
        const setup = deps.setups.byId(id);
        if (!setup) throw new ToolError(`Setup ${id} tidak ditemukan.`);
        return { content: JSON.stringify(compactSetup(setup)), summary: `${setup.direction} @ ${formatPrice(setup.entry)} (${setup.status})` };
      },
    },
    {
      def: { name: 'runPlaybook', description: 'Jalankan ulang analisa playbook sekarang: intraday_m30_m15 (A) atau scalp_m15_m5 (B).', inputSchema: schemaToJson(playbookArgs) },
      run: async (raw) => {
        const { playbook } = playbookArgs.parse(raw);
        const { result, events } = deps.runner.runNow(playbook);
        deps.onRunnerEvents(events);
        const content = JSON.stringify({
          playbook,
          bias: result.bias,
          direction: result.direction,
          candidates: result.candidates.map((c) => ({ id: c.id, type: c.type, top: c.top, bottom: c.bottom, score: c.score })),
          best: result.best ? compactSetup(result.best) : null,
          reasons: result.reasons,
        });
        return { content, summary: result.best ? `${PLAYBOOKS[playbook].shortLabel}: setup ${result.best.direction} @ ${formatPrice(result.best.entry)}` : `${PLAYBOOKS[playbook].shortLabel}: tidak ada setup` };
      },
    },
    {
      def: { name: 'getMetrics', description: 'Metrik desk: harga terakhir, sesi, ATR M15, statistik jurnal, LLM spend, status feed.', inputSchema: schemaToJson(z.object({})) },
      run: async () => {
        const m = deps.metrics();
        return { content: JSON.stringify(m), summary: `harga ${m.lastPrice === null ? '—' : formatPrice(m.lastPrice)}` };
      },
    },
    {
      def: {
        name: 'drawAnnotation',
        description: 'Gambar di chart: garis harga (hline), kotak (box) atau penanda (marker). Harga HARUS berasal dari level yang dikembalikan tool lain (zona, setup, BOS/CHoCH, swing).',
        inputSchema: schemaToJson(drawArgs),
      },
      run: async (raw) => {
        const args = drawArgs.parse(raw);
        const levels = knownLevels(deps);
        let drawing: Drawing;
        if (args.kind === 'hline') {
          assertKnownLevel(args.price, levels, 'Harga');
          drawing = DrawingSchema.parse({ kind: 'hline', id: newId('drw'), price: args.price, label: args.label, tf: args.tf, style: args.style ?? 'dashed' });
        } else if (args.kind === 'box') {
          assertKnownLevel(args.top, levels, 'Top');
          assertKnownLevel(args.bottom, levels, 'Bottom');
          const fromTime = args.fromTime ?? deps.feed.closedCandles('M15', 40)[0]?.time ?? 0;
          drawing = DrawingSchema.parse({ kind: 'box', id: newId('drw'), top: Math.max(args.top, args.bottom), bottom: Math.min(args.top, args.bottom), fromTime, toTime: null, label: args.label, tf: args.tf });
        } else {
          drawing = DrawingSchema.parse({ kind: 'marker', id: newId('drw'), time: args.time, position: args.position, text: args.text, tf: args.tf });
        }
        deps.drawings.add(drawing);
        deps.onDrawing('add', drawing);
        return { content: JSON.stringify({ ok: true, drawing }), summary: `gambar ${drawing.kind} ditambahkan` };
      },
    },
    {
      def: { name: 'removeAnnotation', description: 'Hapus satu gambar copilot (id) atau semua (all=true).', inputSchema: schemaToJson(removeArgs) },
      run: async (raw) => {
        const args = removeArgs.parse(raw);
        if (args.all || !args.id) {
          deps.drawings.clear();
          deps.onDrawing('clear');
          return { content: JSON.stringify({ ok: true, cleared: true }), summary: 'semua gambar dihapus' };
        }
        const removed = deps.drawings.remove(args.id);
        if (removed) deps.onDrawing('remove', undefined, args.id);
        return { content: JSON.stringify({ ok: removed }), summary: removed ? 'gambar dihapus' : 'id tidak ditemukan' };
      },
    },
  ];
}
