'use client';

import {
  PLAYBOOKS,
  type AgentEvent,
  type AgentName,
  type AgentState,
  type AnalysisSnapshot,
  type Candle,
  type ChatMessage,
  type ChatToolCall,
  type Drawing,
  type FeedStatus,
  type Metrics,
  type PlaybookId,
  type ReplayState,
  type Setup,
  type SetupStatus,
  type Timeframe,
  type WsServerMessage,
  isTerminalStatus,
} from '@aurum/shared';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { CHART_HISTORY_LIMIT } from '@/lib/config';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';
export type Layer = 'swings' | 'structure' | 'zones' | 'levels';
export type Transition = { setup: Setup; transition: SetupStatus; at: number };
export type MobileTab = 'chart' | 'setups' | 'log' | 'chat';

const MAX_EVENTS = 400;
const MAX_CHAT = 200;

export type DeskState = {
  connection: ConnectionStatus;
  symbol: string;
  feed: FeedStatus | null;
  candles: Record<Timeframe, readonly Candle[]>;
  analysis: Partial<Record<Timeframe, AnalysisSnapshot>>;
  setups: readonly Setup[];
  events: readonly AgentEvent[];
  agents: readonly AgentState[];
  metrics: Metrics | null;
  replay: ReplayState | null;
  drawings: readonly Drawing[];
  chat: readonly ChatMessage[];
  chatStreaming: string | null;
  lastTransition: Transition | null;
  ui: {
    tf: Timeframe;
    playbook: PlaybookId;
    focusedSetupId: string | null;
    focusNonce: number;
    hoveredZoneId: string | null;
    hoverPoint: { x: number; y: number } | null;
    layers: Record<Layer, boolean>;
    logFilter: AgentName | 'all';
    mobileTab: MobileTab;
  };
  // actions
  handleMessage: (message: WsServerMessage) => void;
  setConnection: (status: ConnectionStatus) => void;
  setTf: (tf: Timeframe) => void;
  setPlaybook: (playbook: PlaybookId) => void;
  focusSetup: (id: string | null) => void;
  setHoveredZone: (id: string | null, point: { x: number; y: number } | null) => void;
  toggleLayer: (layer: Layer) => void;
  setLogFilter: (filter: AgentName | 'all') => void;
  setMobileTab: (tab: MobileTab) => void;
  addChatMessage: (message: ChatMessage) => void;
};

const EMPTY_CANDLES: Record<Timeframe, readonly Candle[]> = { M1: [], M5: [], M15: [], M30: [] };

function applyCandle(list: readonly Candle[], candle: Candle): readonly Candle[] {
  const last = list[list.length - 1];
  if (!last || candle.time > last.time) return [...list, candle].slice(-CHART_HISTORY_LIMIT);
  if (candle.time === last.time) return [...list.slice(0, -1), candle];
  return list; // older than the last bar: ignore (chart cannot update history anyway)
}

function upsertSetup(list: readonly Setup[], setup: Setup): readonly Setup[] {
  const idx = list.findIndex((s) => s.id === setup.id);
  if (idx < 0) return [setup, ...list];
  return list.map((s) => (s.id === setup.id ? setup : s));
}

function patchStreamingChat(list: readonly ChatMessage[], id: string, patch: (m: ChatMessage) => ChatMessage): readonly ChatMessage[] {
  const existing = list.find((m) => m.id === id);
  if (!existing) {
    const created: ChatMessage = { id, role: 'assistant', content: '', ts: new Date().toISOString(), toolCalls: [] };
    return [...list, patch(created)].slice(-MAX_CHAT);
  }
  return list.map((m) => (m.id === id ? patch(m) : m));
}

function mergeToolCall(calls: readonly ChatToolCall[] | undefined, call: ChatToolCall): ChatToolCall[] {
  const list = calls ?? [];
  return list.some((c) => c.id === call.id) ? list.map((c) => (c.id === call.id ? call : c)) : [...list, call];
}

export const useDeskStore = create<DeskState>()(
  subscribeWithSelector((set, get) => ({
    connection: 'connecting',
    symbol: 'XAUUSD',
    feed: null,
    candles: EMPTY_CANDLES,
    analysis: {},
    setups: [],
    events: [],
    agents: [],
    metrics: null,
    replay: null,
    drawings: [],
    chat: [],
    chatStreaming: null,
    lastTransition: null,
    ui: {
      tf: 'M5',
      playbook: 'scalp_m15_m5',
      focusedSetupId: null,
      focusNonce: 0,
      hoveredZoneId: null,
      hoverPoint: null,
      layers: { swings: true, structure: true, zones: true, levels: true },
      logFilter: 'all',
      mobileTab: 'chart',
    },

    handleMessage: (message) => {
      switch (message.type) {
        case 'hello':
          set({ symbol: message.symbol, feed: message.feed, connection: 'open', replay: message.feed.replay ?? null });
          return;
        case 'candles':
          set((s) => ({ candles: { ...s.candles, [message.tf]: message.candles.slice(-CHART_HISTORY_LIMIT) } }));
          return;
        case 'candle':
          set((s) => ({ candles: { ...s.candles, [message.tf]: applyCandle(s.candles[message.tf], message.candle) } }));
          return;
        case 'analysis':
          set((s) => ({ analysis: { ...s.analysis, [message.snapshot.tf]: message.snapshot } }));
          return;
        case 'setups':
          set({ setups: message.setups });
          return;
        case 'setup':
          set((s) => ({
            setups: upsertSetup(s.setups, message.setup),
            lastTransition: message.transition ? { setup: message.setup, transition: message.transition, at: Date.now() } : s.lastTransition,
          }));
          return;
        case 'agentEvent':
          // The hello snapshot re-sends recent events on reconnect; keep ids unique.
          set((s) => (s.events.some((e) => e.id === message.event.id) ? {} : { events: [...s.events, message.event].slice(-MAX_EVENTS) }));
          return;
        case 'agentStates':
          set({ agents: message.states });
          return;
        case 'metrics':
          set({ metrics: message.metrics, feed: message.metrics.feed, replay: message.metrics.feed.replay ?? get().replay });
          return;
        case 'replay':
          set({ replay: message.state });
          return;
        case 'drawing':
          set((s) => {
            if (message.action === 'clear') return { drawings: [] };
            if (message.action === 'remove') return { drawings: s.drawings.filter((d) => d.id !== message.drawingId) };
            if (!message.drawing) return {};
            return { drawings: [...s.drawings.filter((d) => d.id !== message.drawing!.id), message.drawing] };
          });
          return;
        case 'chatMessage':
          set((s) => ({ chat: [...s.chat.filter((m) => m.id !== message.message.id), message.message].slice(-MAX_CHAT) }));
          return;
        case 'chatToken':
          set((s) => ({
            chatStreaming: message.done ? null : message.messageId,
            chat: patchStreamingChat(s.chat, message.messageId, (m) => ({
              ...m,
              content: m.content + (message.token ?? '') + (message.error ? `\n⚠ ${message.error}` : ''),
              toolCalls: message.toolCall ? mergeToolCall(m.toolCalls, message.toolCall) : m.toolCalls,
            })),
          }));
          return;
        case 'error': {
          const errorEvent: AgentEvent = {
            id: `err-${Date.now()}`,
            ts: new Date().toISOString(),
            agent: 'system',
            level: 'error',
            summary: message.message,
            source: 'rules',
          };
          set((s) => ({ events: [...s.events, errorEvent].slice(-MAX_EVENTS) }));
          return;
        }
        default:
          return;
      }
    },
    setConnection: (connection) => set({ connection }),
    setTf: (tf) => set((s) => ({ ui: { ...s.ui, tf } })),
    setPlaybook: (playbook) => set((s) => ({ ui: { ...s.ui, playbook } })),
    focusSetup: (id) =>
      set((s) => {
        const setup = id ? s.setups.find((x) => x.id === id) : undefined;
        const tf = setup ? PLAYBOOKS[setup.playbook].entryTf : s.ui.tf;
        const playbook = setup ? setup.playbook : s.ui.playbook;
        return { ui: { ...s.ui, focusedSetupId: id, focusNonce: s.ui.focusNonce + 1, tf, playbook, mobileTab: 'chart' } };
      }),
    setHoveredZone: (hoveredZoneId, hoverPoint) => set((s) => ({ ui: { ...s.ui, hoveredZoneId, hoverPoint } })),
    toggleLayer: (layer) => set((s) => ({ ui: { ...s.ui, layers: { ...s.ui.layers, [layer]: !s.ui.layers[layer] } } })),
    setLogFilter: (logFilter) => set((s) => ({ ui: { ...s.ui, logFilter } })),
    setMobileTab: (mobileTab) => set((s) => ({ ui: { ...s.ui, mobileTab } })),
    addChatMessage: (message) => set((s) => ({ chat: [...s.chat, message].slice(-MAX_CHAT) })),
  })),
);

/** Derived selectors (pure). */
export const selectActiveSetups = (s: DeskState): Setup[] => s.setups.filter((x) => !isTerminalStatus(x.status));
export const selectJournal = (s: DeskState): Setup[] => s.setups.filter((x) => isTerminalStatus(x.status));
export const selectSetupsForPlaybook = (playbook: PlaybookId) => (s: DeskState) => s.setups.filter((x) => x.playbook === playbook);

/** The "other" timeframe of the active playbook, for the mini chart. */
export function miniTimeframe(tf: Timeframe, playbook: PlaybookId): Timeframe {
  const { biasTf, entryTf } = PLAYBOOKS[playbook];
  return tf === entryTf ? biasTf : entryTf;
}
