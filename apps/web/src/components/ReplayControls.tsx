'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useDeskStore } from '@/store/desk-store';

const SPEEDS = [1, 5, 20, 100, 600] as const;

export function ReplayControls() {
  const replay = useDeskStore((s) => s.replay);
  const [error, setError] = useState<string | null>(null);
  if (!replay) return null;
  const run = (fn: () => Promise<unknown>) => () => {
    setError(null);
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : 'gagal'));
  };
  const progress = replay.totalCandles > 0 ? Math.min(100, (replay.position / replay.totalCandles) * 100) : 0;
  return (
    <section className="flex h-9 shrink-0 items-center gap-2 border border-t-0 border-line bg-elev px-2 text-[11px]" data-testid="replay-controls">
      <span className="text-[10px] uppercase tracking-wider text-faint">replay</span>
      <button type="button" onClick={run(() => api.replay(replay.playing ? 'pause' : 'play'))} className="h-6 w-7 border border-line hover:border-line-strong" aria-label={replay.playing ? 'Jeda' : 'Putar'}>
        {replay.playing ? '⏸' : '▶'}
      </button>
      <button type="button" onClick={run(() => api.replay('restart'))} className="h-6 w-7 border border-line hover:border-line-strong" aria-label="Ulangi" title="Ulangi dari awal">
        ↺
      </button>
      <div className="flex items-stretch border border-line">
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={run(() => api.replaySpeed(s))} className={`px-2 text-[10px] ${replay.speed === s ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'}`} aria-pressed={replay.speed === s}>
            {s}×
          </button>
        ))}
      </div>
      <div className="relative mx-2 h-1 min-w-0 flex-1 bg-line" title={`${replay.position}/${replay.totalCandles} candle`}>
        <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${progress}%` }} />
      </div>
      <span className="tabular hidden text-[10px] text-muted sm:inline">{replay.cursorTime ? `${fmtDateTime(replay.cursorTime)} WIB` : '—'}</span>
      {error ? <span className="text-[10px] text-down">{error}</span> : null}
    </section>
  );
}
