'use client';

import { AGENT_LABELS, AGENT_NAMES, type AgentState } from '@aurum/shared';
import { fmtTime } from '@/lib/format';
import { useDeskStore } from '@/store/desk-store';
import { Panel } from './Panel';

const STATE_DOT: Record<AgentState['state'], string> = { idle: 'bg-up', running: 'bg-accent pulse-dot', error: 'bg-down', disabled: 'bg-faint' };

export function AgentsPanel() {
  const agents = useDeskStore((s) => s.agents);
  const byName = new Map(agents.map((a) => [a.agent, a] as const));
  const visible = AGENT_NAMES.filter((n) => n !== 'system');
  return (
    <Panel title="Agents" right={<span>{agents.some((a) => a.mode === 'llm') ? 'LLM' : 'rule-based'}</span>} className="">
      <ul className="divide-y divide-line">
        {visible.map((name) => {
          const a = byName.get(name);
          return (
            <li key={name} className="flex items-center gap-2 px-3 py-1 text-[11px]" data-testid={`agent-${name}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[a?.state ?? 'disabled']}`} aria-hidden />
              <span className="w-20 font-semibold">{AGENT_LABELS[name]}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{a?.lastSummary ?? 'menunggu candle close…'}</span>
              <span className="tabular text-[10px] text-faint">{a?.lastRunAt ? fmtTime(a.lastRunAt) : '—'}</span>
              <span className="tabular w-8 text-right text-[10px] text-faint">{a?.runs ?? 0}×</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
