'use client';

import { PLAYBOOKS, type SetupStatus } from '@aurum/shared';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { connectDesk } from '@/lib/ws-client';
import { formatPrice } from '@/lib/format';
import { showBrowserNotification } from '@/lib/notifications';
import { useKeyboardShortcuts } from '@/lib/shortcuts';
import { useTheme } from '@/lib/theme';
import { useDeskStore, type MobileTab } from '@/store/desk-store';
import { ActivityLog } from './ActivityLog';
import { AgentsPanel } from './AgentsPanel';
import { ChatPanel } from './ChatPanel';
import { HeaderMetrics } from './HeaderMetrics';
import { MainChart } from './MainChart';
import { MiniChart } from './MiniChart';
import { ReplayControls } from './ReplayControls';
import { SetupCards } from './SetupCards';

const ALERT_STATUSES: ReadonlySet<SetupStatus> = new Set(['valid', 'triggered', 'tp1', 'tp2', 'stopped']);
const ALERT_TITLE: Record<string, string> = { valid: 'Setup VALID', triggered: 'Entry tersentuh', tp1: 'TP1 tercapai', tp2: 'TP2 tercapai ✦', stopped: 'Stop loss' };
const MOBILE_TABS: Array<[MobileTab, string]> = [
  ['chart', 'Chart'],
  ['setups', 'Setup'],
  ['log', 'Log'],
  ['chat', 'Chat'],
];

function useTransitionAlerts(): void {
  const transition = useDeskStore((s) => s.lastTransition);
  const focusSetup = useDeskStore((s) => s.focusSetup);
  useEffect(() => {
    if (!transition || !ALERT_STATUSES.has(transition.transition)) return;
    const { setup } = transition;
    const title = ALERT_TITLE[transition.transition] ?? transition.transition;
    const body = `${PLAYBOOKS[setup.playbook].shortLabel} ${setup.direction.toUpperCase()} @ ${formatPrice(setup.entry)} · SL ${formatPrice(setup.stopLoss)} · TP1 ${formatPrice(setup.tp1)} · TP2 ${formatPrice(setup.tp2)}`;
    const fn = transition.transition === 'stopped' ? toast.error : transition.transition === 'valid' || transition.transition === 'triggered' ? toast.info : toast.success;
    fn(title, { description: body, id: `${setup.id}:${transition.transition}`, action: { label: 'Lihat', onClick: () => focusSetup(setup.id) } });
    showBrowserNotification(`${title} — ${setup.symbol}`, body, setup.id);
  }, [transition, focusSetup]);
}

export function Desk() {
  const toggleTheme = useTheme((s) => s.toggle);
  const mobileTab = useDeskStore((s) => s.ui.mobileTab);
  const setMobileTab = useDeskStore((s) => s.setMobileTab);
  const onToggleTheme = useCallback(() => toggleTheme(), [toggleTheme]);
  useKeyboardShortcuts(onToggleTheme);
  useTransitionAlerts();

  useEffect(() => {
    const handle = connectDesk();
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __desk?: unknown }).__desk = useDeskStore;
    return () => handle.close();
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <HeaderMetrics />
      <nav className="flex shrink-0 border-b border-line lg:hidden" aria-label="Tab mobile">
        {MOBILE_TABS.map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setMobileTab(tab)} className={`h-8 flex-1 text-[11px] uppercase tracking-wider ${mobileTab === tab ? 'bg-accent-soft text-accent' : 'text-muted'}`} aria-pressed={mobileTab === tab}>
            {label}
          </button>
        ))}
      </nav>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-bg p-1 lg:grid-cols-[minmax(0,7fr)_minmax(340px,3fr)]">
        <div className={`${mobileTab === 'chart' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
          <MainChart />
          <MiniChart />
          <ReplayControls />
        </div>
        <aside className={`${mobileTab === 'chart' ? 'hidden' : 'grid'} min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1 lg:grid lg:grid-rows-[auto_minmax(0,5fr)_minmax(0,4fr)_minmax(0,4fr)]`}>
          <div className={`${mobileTab === 'setups' ? 'block' : 'hidden'} lg:block`}>
            <AgentsPanel />
          </div>
          <div className={`${mobileTab === 'setups' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
            <SetupCards />
          </div>
          <div className={`${mobileTab === 'log' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
            <ActivityLog />
          </div>
          <div className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
            <ChatPanel />
          </div>
        </aside>
      </main>
      <footer className="flex h-5 shrink-0 items-center justify-between border-t border-line bg-elev px-3 text-[9px] uppercase tracking-[0.14em] text-faint">
        <span>Bukan saran finansial — alat analisa, bukan eksekusi</span>
        <span className="hidden sm:inline">1–4 timeframe · A/B playbook · T tema · Esc lepas fokus</span>
      </footer>
    </div>
  );
}
