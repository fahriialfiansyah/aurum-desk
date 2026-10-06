import type { LLMProvider, LlmMessage, SpendTracker } from '@aurum/llm';
import { LlmError } from '@aurum/llm';
import { newId, type ChatMessage, type ChatToolCall, type WsServerMessage } from '@aurum/shared';
import type { Logger } from '../logger';
import type { EventLog } from '../state/event-log';
import { answerWithRules, type RulesDeps } from './rules';
import type { CopilotTool } from './tools';

export type CopilotDeps = {
  llm: LLMProvider | null;
  spend: SpendTracker;
  tools: CopilotTool[];
  events: EventLog;
  publish: (message: WsServerMessage) => void;
  persist: (conversationId: string, message: ChatMessage) => void;
  /** One-paragraph live context prepended to every LLM turn (price, session, active setups). */
  context: () => string;
  rules: RulesDeps;
  logger: Logger;
};

export const MAX_TOOL_ITERATIONS = 6;
const HISTORY_TURNS = 16;
const CHAT_MAX_TOKENS = 1200;
const RULES_STREAM_CHUNK = 24;
const DEFAULT_CONVERSATION = 'default';

export const COPILOT_SYSTEM_PROMPT = [
  'Kamu adalah copilot di meja trading XAUUSD pribadi (analisa saja, tidak pernah eksekusi order).',
  'Jawab dalam Bahasa Indonesia yang ringkas dan teknis; istilah trading tetap Inggris (BOS, CHoCH, supply/demand, RR, SL/TP).',
  'ATURAN KERAS: jangan pernah mengarang atau membulatkan level harga. Sebutkan harga HANYA yang berasal dari hasil tool (getZones, getSetups, getStructure, explainSetup, runPlaybook).',
  'Gunakan tool sebelum menjawab pertanyaan tentang struktur, zona, setup, atau metrik. Untuk "kenapa setup ini valid?" panggil explainSetup pada setup fokus (lihat "[setup fokus: id]") atau getSetups.',
  'drawAnnotation hanya boleh memakai harga dari hasil tool. Jika diminta menggambar sesuatu tanpa level yang jelas, tanyakan dulu.',
  'Format: paragraf pendek atau bullet; harga selalu 2 desimal; sebutkan status setup dan RR 1:1.5 / 1:2 bila relevan. Bukan saran finansial.',
].join(' ');

/** Streams one assistant turn over the WS hub while running the tool loop. */
export class Copilot {
  private readonly history = new Map<string, LlmMessage[]>();

  constructor(private readonly deps: CopilotDeps) {}

  /** Returns at once with the id of the assistant message that will stream in. */
  async handle(request: { message: string; conversationId?: string }): Promise<{ messageId: string }> {
    const conversationId = request.conversationId ?? DEFAULT_CONVERSATION;
    const messageId = newId('msg');
    const userMessage: ChatMessage = { id: newId('msg'), role: 'user', content: request.message, ts: new Date().toISOString() };
    this.deps.persist(conversationId, userMessage);
    void this.run(conversationId, request.message, messageId).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ error: reason }, 'copilot gagal');
      this.deps.publish({ type: 'chatToken', messageId, error: reason, done: true });
    });
    return { messageId };
  }

  private async run(conversationId: string, text: string, messageId: string): Promise<void> {
    const { llm, spend } = this.deps;
    this.deps.events.setAgentState('copilot', { state: 'running' });
    const started = Date.now();
    const result =
      llm && spend.canSpend() ? await this.runLlm(conversationId, text, messageId, llm) : await this.runRules(text, messageId, llm !== null);
    const message: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: result.text,
      ts: new Date().toISOString(),
      toolCalls: result.toolCalls,
      source: result.source,
    };
    this.deps.publish({ type: 'chatToken', messageId, done: true });
    this.deps.publish({ type: 'chatMessage', message });
    this.deps.persist(conversationId, message);
    this.deps.events.record({
      agent: 'copilot',
      level: 'info',
      summary: `Q: ${text.replace(/\[setup fokus:[^\]]*\]/, '').trim().slice(0, 60)} → ${result.text.replace(/\s+/g, ' ').slice(0, 90)}`,
      source: result.source,
      tokens: result.tokens,
      durationMs: Date.now() - started,
    });
  }

  private async runRules(text: string, messageId: string, llmConfigured: boolean): Promise<{ text: string; toolCalls: ChatToolCall[]; source: 'rules'; tokens?: undefined }> {
    const answer = await answerWithRules(text, this.deps.rules);
    const prefix = llmConfigured ? 'Anggaran token LLM untuk siklus/hari ini habis — jawaban rule-based.\n' : '';
    const full = prefix + answer.text;
    for (let i = 0; i < full.length; i += RULES_STREAM_CHUNK) {
      this.deps.publish({ type: 'chatToken', messageId, token: full.slice(i, i + RULES_STREAM_CHUNK) });
    }
    const toolCalls: ChatToolCall[] = answer.toolsUsed.map((name) => ({ id: newId('tc'), name, args: {}, status: 'done' }));
    return { text: full, toolCalls, source: 'rules' };
  }

  private async runLlm(
    conversationId: string,
    text: string,
    messageId: string,
    llm: LLMProvider,
  ): Promise<{ text: string; toolCalls: ChatToolCall[]; source: 'llm' | 'rules'; tokens?: { input: number; output: number } }> {
    const { spend, tools } = this.deps;
    const history = this.history.get(conversationId) ?? [];
    const messages: LlmMessage[] = [...history, { role: 'user', content: `${text}\n\n[konteks desk] ${this.deps.context()}` }];
    const toolCalls: ChatToolCall[] = [];
    const tokens = { input: 0, output: 0 };
    let reply = '';
    const byName = new Map(tools.map((t) => [t.def.name, t] as const));

    try {
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        if (!spend.canSpend()) break;
        const res = await llm.complete(messages, {
          system: COPILOT_SYSTEM_PROMPT,
          tools: tools.map((t) => t.def),
          maxTokens: CHAT_MAX_TOKENS,
          effort: 'medium',
          onToken: (token) => this.deps.publish({ type: 'chatToken', messageId, token }),
        });
        spend.record(res.usage, llm.model);
        tokens.input += res.usage.inputTokens;
        tokens.output += res.usage.outputTokens;
        reply += res.text;
        if (res.stopReason === 'refusal') {
          reply += '\n(Model menolak menjawab bagian ini.)';
          break;
        }
        if (res.toolCalls.length === 0) break;
        messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });
        for (const call of res.toolCalls) {
          const chip: ChatToolCall = { id: call.id, name: call.name, args: call.args, status: 'running' };
          this.deps.publish({ type: 'chatToken', messageId, toolCall: chip });
          const tool = byName.get(call.name);
          let content: string;
          let finished: ChatToolCall;
          try {
            if (!tool) throw new Error(`tool ${call.name} tidak ada`);
            const out = await tool.run(call.args);
            content = out.content;
            finished = { ...chip, status: 'done', resultSummary: out.summary };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            content = JSON.stringify({ error: reason });
            finished = { ...chip, status: 'error', resultSummary: reason };
          }
          toolCalls.push(finished);
          this.deps.publish({ type: 'chatToken', messageId, toolCall: finished });
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
        }
      }
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      this.deps.logger.warn({ error: error.message }, 'copilot LLM gagal — fallback rule-based');
      const rules = await answerWithRules(text, this.deps.rules);
      const fallback = `${reply ? `${reply}\n\n` : ''}(LLM gagal: ${error.message}) ${rules.text}`;
      this.deps.publish({ type: 'chatToken', messageId, token: fallback.slice(reply.length) });
      return { text: fallback, toolCalls, source: 'rules', tokens };
    }

    if (!reply.trim()) reply = 'Tidak ada jawaban dari model.';
    const trimmed = [...history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: reply }].slice(-HISTORY_TURNS);
    this.history.set(conversationId, trimmed);
    return { text: reply, toolCalls, source: 'llm', tokens };
  }
}
