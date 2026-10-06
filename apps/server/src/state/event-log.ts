import { newId, type AgentEvent, type AgentName, type AgentState } from '@aurum/shared';

export const DEFAULT_MAX_EVENTS = 500;

export type EventInput = Omit<AgentEvent, 'id' | 'ts'> & { ts?: string };

/** Ring buffer of agent events plus per-agent state, shared by the runner, agents and the API. */
export class EventLog {
  private events: AgentEvent[] = [];
  private states = new Map<AgentName, AgentState>();
  private readonly max: number;
  private listeners = new Set<(event: AgentEvent) => void>();

  constructor(options: { max?: number } = {}) {
    this.max = options.max ?? DEFAULT_MAX_EVENTS;
    for (const agent of ['structure', 'zones', 'validator', 'risk', 'copilot', 'system'] as const) {
      this.states.set(agent, { agent, state: 'idle', lastRunAt: null, lastSummary: null, runs: 0, mode: 'rules' });
    }
  }

  load(events: readonly AgentEvent[]): void {
    this.events = events.slice(-this.max);
  }

  record(input: EventInput): AgentEvent {
    const event: AgentEvent = { ...input, id: newId('evt'), ts: input.ts ?? new Date().toISOString() };
    this.events = [...this.events, event].slice(-this.max);
    const prev = this.states.get(event.agent);
    if (prev) {
      this.states.set(event.agent, {
        ...prev,
        state: event.level === 'error' ? 'error' : 'idle',
        lastRunAt: event.ts,
        lastSummary: event.summary,
        runs: prev.runs + 1,
        mode: event.source ?? prev.mode,
      });
    }
    for (const l of this.listeners) l(event);
    return event;
  }

  setAgentState(agent: AgentName, patch: Partial<AgentState>): void {
    const prev = this.states.get(agent);
    if (prev) this.states.set(agent, { ...prev, ...patch });
  }

  recent(limit = 200): AgentEvent[] {
    return this.events.slice(-limit);
  }

  agentStates(): AgentState[] {
    return [...this.states.values()];
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
