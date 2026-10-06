'use client';

import { AGENT_LABELS, AGENT_NAMES, type AgentEvent, type AgentName } from '@aurum/shared';
import { useEffect, useRef } from 'react';
import { fmtTimeSec } from '@/lib/format';
import { useDeskStore } from '@/store/desk-store';
import { Panel } from './Panel';

const LEVEL_CLS: Record<AgentEvent['level'], string> = { info: 'text-fg', success: 'text-up', warn: 'text-warn', error: 'text-down' };
const LEVEL_ICON: Record<AgentEvent['level'], string> = { info: '·', success: '✦', warn: '▲', error: '✕' };

export function ActivityLog() {
  const events = useDeskStore((s) => s.events);
  const filter = useDeskStore((s) => s.ui.logFilter);
  const setFilter = useDeskStore((s) => s.setLogFilter);
  const focusSetup = useDeskStore((s) => s.focusSetup);
  const endRef = useRef<HTMLDivElement | null>(null);
  const visible = filter === 'all' ? events : events.filter((e) => e.agent === filter);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length]);

  return (
    <Panel
      title="Activity log"
      className="h-full"
      right={
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as AgentName | 'all')}
          className="h-5 border border-line bg-elev px-1 text-[10px] text-muted"
          aria-label="Filter agen"
        >
          <option value="all">semua</option>
          {AGENT_NAMES.map((n) => (
            <option key={n} value={n}>
              {AGENT_LABELS[n]}
            </option>
          ))}
        </select>
      }
    >
      <ol className="px-2 py-1" data-testid="activity-log">
        {visible.map((e) => (
          <li key={e.id} className="flex gap-2 py-0.5 text-[11px] leading-snug fade-in">
            <span className="tabular shrink-0 text-faint">{fmtTimeSec(e.ts)}</span>
            <span className="w-16 shrink-0 text-muted">{AGENT_LABELS[e.agent]}</span>
            <span className={`shrink-0 ${LEVEL_CLS[e.level]}`}>{LEVEL_ICON[e.level]}</span>
            <span className={`min-w-0 flex-1 ${LEVEL_CLS[e.level]}`}>
              {e.setupId ? (
                <button type="button" className="text-left hover:underline" onClick={() => focusSetup(e.setupId!)}>
                  {e.summary}
                </button>
              ) : (
                e.summary
              )}
              {e.source === 'llm' ? <span className="ml-1 text-[9px] text-accent">LLM</span> : null}
            </span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>
    </Panel>
  );
}
