'use client';

import { useShallow } from 'zustand/react/shallow';
import { selectActiveSetups, selectJournal, useDeskStore } from '@/store/desk-store';
import { Panel } from './Panel';
import { SetupCard } from './SetupCard';

export function SetupCards() {
  const active = useDeskStore(useShallow(selectActiveSetups));
  const journal = useDeskStore(useShallow(selectJournal));
  const lastPrice = useDeskStore((s) => s.metrics?.lastPrice ?? null);
  const focusedId = useDeskStore((s) => s.ui.focusedSetupId);
  const focusSetup = useDeskStore((s) => s.focusSetup);
  return (
    <Panel title="Setup aktif" right={<span>{active.length} aktif · {journal.length} selesai</span>} className="h-full">
      {active.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-faint">Belum ada setup. Agen memantau setiap candle close…</p>
      ) : (
        active.map((s) => <SetupCard key={s.id} setup={s} lastPrice={lastPrice} focused={s.id === focusedId} onFocus={focusSetup} />)
      )}
      {journal.length > 0 ? (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-3 py-1.5 text-[10px] uppercase tracking-wider text-faint hover:text-fg">Jurnal ({journal.length})</summary>
          {journal.slice(0, 30).map((s) => (
            <SetupCard key={s.id} setup={s} lastPrice={lastPrice} focused={s.id === focusedId} onFocus={focusSetup} />
          ))}
        </details>
      ) : null}
    </Panel>
  );
}
