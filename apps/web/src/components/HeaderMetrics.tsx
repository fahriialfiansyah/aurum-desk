'use client';

import { SESSION_LABEL_ID } from '@aurum/shared';
import { useEffect, useRef, useState } from 'react';
import { fmtPct, fmtR, fmtSigned, fmtTokens, formatPrice } from '@/lib/format';
import { notificationPermission, requestNotificationPermission, type NotifyPermission } from '@/lib/notifications';
import { useDeskStore } from '@/store/desk-store';
import { FeedStatusChip } from './FeedStatusChip';
import { ThemeToggle } from './ThemeToggle';

function Metric({ label, value, tone, testId }: { label: string; value: string; tone?: 'up' | 'down' | 'accent' | 'muted'; testId?: string }) {
  const toneClass = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-muted' : 'text-fg';
  return (
    <div className="flex min-w-0 flex-col justify-center border-r border-line px-3 last:border-r-0">
      <span className="text-[9px] uppercase tracking-[0.14em] text-faint">{label}</span>
      <span className={`tabular truncate text-[12px] ${toneClass}`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

export function HeaderMetrics() {
  const metrics = useDeskStore((s) => s.metrics);
  const feed = useDeskStore((s) => s.feed);
  const connection = useDeskStore((s) => s.connection);
  const symbol = useDeskStore((s) => s.symbol);
  const [flash, setFlash] = useState<'flash-up' | 'flash-down' | ''>('');
  const prevPrice = useRef<number | null>(null);
  const [notif, setNotif] = useState<NotifyPermission>('default');

  useEffect(() => setNotif(notificationPermission()), []);

  useEffect(() => {
    const price = metrics?.lastPrice ?? null;
    if (price !== null && prevPrice.current !== null && price !== prevPrice.current) {
      setFlash(price > prevPrice.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 600);
      prevPrice.current = price;
      return () => clearTimeout(t);
    }
    prevPrice.current = price;
    return undefined;
  }, [metrics?.lastPrice]);

  const change = metrics?.change ?? null;
  const arrow = change === null ? '' : change >= 0 ? '▲' : '▼';
  const tone = change === null ? 'muted' : change >= 0 ? 'up' : 'down';

  return (
    <header className="flex h-12 shrink-0 items-stretch border-b border-line bg-elev">
      <div className="flex items-center gap-3 border-r border-line px-3">
        <span className="text-[13px] font-bold tracking-tight text-accent">✦ aurum-desk</span>
        <span className="hidden text-[10px] uppercase tracking-[0.14em] text-faint sm:inline">{symbol}</span>
      </div>
      <div className={`flex items-center border-r border-line px-3 ${flash}`}>
        <span className="tabular text-[18px] font-semibold" data-testid="last-price">
          {metrics?.lastPrice != null ? formatPrice(metrics.lastPrice) : '—'}
        </span>
        <span className={`tabular ml-2 text-[11px] ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-muted'}`}>
          {change === null ? '' : `${arrow} ${fmtSigned(change)} (${fmtSigned(metrics?.changePct ?? 0, 3)}%)`}
        </span>
      </div>
      <div className="hidden min-w-0 flex-1 items-stretch md:flex">
        <Metric label="ATR M15" value={metrics?.atrM15 != null ? metrics.atrM15.toFixed(2) : '—'} />
        <Metric label="Sesi" value={metrics ? SESSION_LABEL_ID[metrics.session] : '—'} tone={metrics?.session === 'closed' ? 'muted' : 'accent'} />
        <Metric label="Setup hari ini" value={metrics ? `${metrics.setupsToday} · aktif ${metrics.activeSetups}` : '—'} />
        <Metric label="Win rate" value={fmtPct(metrics?.winRate ?? null)} tone={(metrics?.winRate ?? 0) >= 0.5 ? 'up' : 'muted'} />
        <Metric label="Avg R" value={fmtR(metrics?.avgR ?? null)} tone={(metrics?.avgR ?? 0) > 0 ? 'up' : (metrics?.avgR ?? 0) < 0 ? 'down' : 'muted'} />
        <Metric
          label="LLM spend"
          value={metrics ? `${fmtTokens(metrics.llm.inputTokens + metrics.llm.outputTokens)} tok · $${metrics.llm.estimatedUsd.toFixed(3)} · ${metrics.llm.provider}` : '—'}
          tone="muted"
        />
      </div>
      <div className="ml-auto flex items-center gap-3 px-3">
        <FeedStatusChip feed={feed} connection={connection} />
        {notif !== 'unsupported' && notif !== 'granted' ? (
          <button
            type="button"
            className="h-6 border border-line px-2 text-[10px] uppercase tracking-wider text-muted hover:text-fg"
            onClick={() => void requestNotificationPermission().then(setNotif)}
            title="Izinkan notifikasi browser untuk alert setup"
          >
            🔔 notif
          </button>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
