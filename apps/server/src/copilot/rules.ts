import { PLAYBOOKS, formatPrice, type PlaybookId, type Setup, type Timeframe } from '@aurum/shared';
import { describeStructure } from '../agents/structure-agent';
import type { CopilotTool } from './tools';
import type { EngineRunner } from '../engine/runner';
import type { SetupStore } from '../state/setup-store';
import type { MarketFeed } from '../market/feed';

export type RulesDeps = { runner: EngineRunner; setups: SetupStore; feed: MarketFeed; tools: CopilotTool[] };

export type RulesAnswer = { text: string; toolsUsed: string[] };

const TF_RE = /\bM\s?(1|5|15|30)\b/i;
const SETUP_REF_RE = /\[setup fokus:\s*([^\]]+)\]/i;

function tfFrom(message: string, fallback: Timeframe): Timeframe {
  const m = TF_RE.exec(message);
  return m ? (`M${m[1]}` as Timeframe) : fallback;
}

function setupLines(s: Setup): string {
  const lines = [
    `Setup ${PLAYBOOKS[s.playbook].shortLabel} ${s.direction.toUpperCase()} — status ${s.status}.`,
    ...s.rationale.deterministic.map((l) => `• ${l}`),
  ];
  if (s.rationale.llm) lines.push(`Catatan agen: ${s.rationale.llm}`);
  return lines.join('\n');
}

/**
 * Deterministic copilot used when LLM_PROVIDER=none (or the budget is exhausted).
 * Answers the common desk questions from engine data and says plainly that it is rule-based.
 */
export async function answerWithRules(message: string, deps: RulesDeps): Promise<RulesAnswer> {
  const text = message.toLowerCase();
  const focusId = SETUP_REF_RE.exec(message)?.[1]?.trim();
  const tool = (name: string) => deps.tools.find((t) => t.def.name === name);

  if (/jalankan|run|ulang/.test(text) && /playbook/.test(text)) {
    const id: PlaybookId = /\bb\b|scalp|m5/.test(text) ? 'scalp_m15_m5' : 'intraday_m30_m15';
    const run = tool('runPlaybook');
    if (!run) return { text: 'Tool runPlaybook tidak tersedia.', toolsUsed: [] };
    const { summary } = await run.run({ playbook: id });
    const result = deps.runner.lastResult(id);
    const best = result?.best;
    const body = best ? setupLines(best) : `Tidak ada setup: ${result?.reasons.join('; ') ?? '—'}`;
    return { text: `Playbook ${PLAYBOOKS[id].shortLabel} dijalankan — ${summary}.\n${body}`, toolsUsed: ['runPlaybook'] };
  }

  if (/kenapa|mengapa|jelaskan|why|explain|valid/.test(text) && /setup|valid|ini/.test(text)) {
    const candidates = deps.setups.active;
    const setup = (focusId && deps.setups.byId(focusId)) || candidates.find((s) => s.status === 'valid') || candidates[0] || deps.setups.journal[0];
    if (!setup) return { text: 'Belum ada setup yang bisa dijelaskan. Agen akan membuat setup saat zona fresh searah bias muncul.', toolsUsed: ['getSetups'] };
    const verdict = setup.status === 'valid' || setup.status === 'triggered' ? 'Setup ini VALID karena:' : `Setup ini belum valid (status ${setup.status}). Yang sudah terpenuhi:`;
    return { text: `${verdict}\n${setupLines(setup)}`, toolsUsed: ['explainSetup'] };
  }

  if (/bias|struktur|structure|trend|tren/.test(text)) {
    const tf = tfFrom(message, 'M30');
    const snap = deps.runner.analysis(tf);
    if (!snap) return { text: `Analisa ${tf} belum tersedia — menunggu candle close pertama.`, toolsUsed: ['getStructure'] };
    const last = deps.feed.closedCandles(tf, 1)[0];
    const { narrative, confidence } = describeStructure({ tf, structure: snap.structure, lastClose: last?.close ?? 0 });
    return { text: `${narrative} (confidence ${confidence})`, toolsUsed: ['getStructure'] };
  }

  if (/zona|zone|supply|demand/.test(text)) {
    const tf = tfFrom(message, 'M15');
    const snap = deps.runner.analysis(tf);
    if (!snap) return { text: `Analisa ${tf} belum tersedia.`, toolsUsed: ['getZones'] };
    const price = deps.feed.lastPrice() ?? 0;
    const wanted = /supply/.test(text) ? 'supply' : /demand/.test(text) ? 'demand' : null;
    const zones = snap.zones
      .filter((z) => !wanted || z.type === wanted)
      .map((z) => ({ z, d: price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    if (zones.length === 0) return { text: `Tidak ada zona ${wanted ?? ''} ${tf} yang aktif saat ini.`, toolsUsed: ['getZones'] };
    const lines = zones.map(({ z, d }) => `• ${z.type} ${z.pattern} ${formatPrice(z.bottom)}–${formatPrice(z.top)} · skor ${z.score} · ${z.fresh ? 'fresh' : `tested ×${z.touches}`} · jarak ${formatPrice(d)}`);
    return { text: `Zona ${wanted ?? 'supply/demand'} ${tf} terdekat dari harga ${formatPrice(price)}:\n${lines.join('\n')}`, toolsUsed: ['getZones'] };
  }

  if (/harga|price|metrik|metrics|sesi|session/.test(text)) {
    const m = await tool('getMetrics')?.run({});
    return { text: m ? `Ringkasan desk: ${m.summary}. ${deps.setups.active.length} setup aktif.` : 'Metrik tidak tersedia.', toolsUsed: ['getMetrics'] };
  }

  return {
    text:
      'Copilot berjalan dalam mode rule-based (LLM_PROVIDER=none). Yang bisa saya jawab:\n' +
      '• "kenapa setup ini valid?" — alasan deterministik setup fokus/terbaru\n' +
      '• "bias M30 sekarang?" / "struktur M15" — narasi struktur\n' +
      '• "zona demand terdekat?" — daftar zona berdasarkan jarak\n' +
      '• "jalankan playbook A/B" — analisa ulang sekarang\n' +
      'Isi ANTHROPIC/OPENAI key atau jalankan Ollama untuk percakapan bebas dan tool gambar.',
    toolsUsed: [],
  };
}
