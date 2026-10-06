'use client';

import { PLAYBOOKS, type Setup } from '@aurum/shared';
import { fmtAge, fmtR, formatPrice } from '@/lib/format';

export const STATUS_STYLE: Record<Setup['status'], { label: string; cls: string }> = {
  watching: { label: 'watching', cls: 'border-line-strong text-muted' },
  valid: { label: 'valid', cls: 'border-accent text-accent' },
  triggered: { label: 'triggered', cls: 'border-info text-info' },
  tp1: { label: 'TP1', cls: 'border-up text-up' },
  tp2: { label: 'TP2', cls: 'border-up bg-up/15 text-up' },
  stopped: { label: 'stopped', cls: 'border-down text-down' },
  invalidated: { label: 'invalid', cls: 'border-line text-faint' },
  expired: { label: 'expired', cls: 'border-line text-faint' },
};

/** R progress: 0 at entry, 1.5 at TP1, 2 at TP2, −1 at SL, based on the last price while open. */
export function rProgress(setup: Setup, lastPrice: number | null): number | null {
  if (!['triggered', 'tp1'].includes(setup.status) || lastPrice === null) return null;
  const move = setup.direction === 'long' ? lastPrice - setup.entry : setup.entry - lastPrice;
  return Math.max(-1, Math.min(2, move / setup.riskPts));
}

type Props = { setup: Setup; lastPrice: number | null; focused: boolean; onFocus: (id: string) => void };

export function SetupCard({ setup, lastPrice, focused, onFocus }: Props) {
  const status = STATUS_STYLE[setup.status];
  const r = rProgress(setup, lastPrice);
  const pct = r === null ? null : ((r + 1) / 3) * 100;
  const dirCls = setup.direction === 'long' ? 'text-up' : 'text-down';
  return (
    <button
      type="button"
      onClick={() => onFocus(setup.id)}
      className={`w-full border-b border-line px-3 py-2 text-left transition-colors hover:bg-elev-2 ${focused ? 'bg-accent-soft' : ''}`}
      data-testid="setup-card"
      aria-pressed={focused}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-xs border border-line px-1 text-[10px] text-muted">{PLAYBOOKS[setup.playbook].shortLabel}</span>
        <span className={`text-[11px] font-semibold ${dirCls}`}>{setup.direction === 'long' ? '▲ LONG' : '▼ SHORT'}</span>
        <span className="text-[10px] text-faint">
          {setup.zone.type} {setup.zone.tf} · {setup.zone.pattern} · skor {setup.zone.score}
        </span>
        <span className={`ml-auto rounded-xs border px-1.5 py-px text-[10px] uppercase tracking-wider ${status.cls}`} data-testid="setup-status">
          {status.label}
        </span>
      </div>
      <div className="tabular mt-1 grid grid-cols-4 gap-1 text-[11px]">
        <div>
          <div className="text-[9px] uppercase text-faint">entry</div>
          <div className="text-ink">{formatPrice(setup.entry)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-faint">SL</div>
          <div className="text-down">{formatPrice(setup.stopLoss)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-faint">TP1 · 1:1.5</div>
          <div className="text-up">{formatPrice(setup.tp1)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-faint">TP2 · 1:2</div>
          <div className="text-up">{formatPrice(setup.tp2)}</div>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
        <span>risiko {formatPrice(setup.riskPts)} pt</span>
        {setup.pressure ? <span>· pressure {setup.pressure.score}</span> : <span>· menunggu harga masuk zona</span>}
        <span className="ml-auto">{setup.realizedR !== undefined ? fmtR(setup.realizedR) : setup.maxFavorableR !== undefined ? `MFE ${fmtR(setup.maxFavorableR)}` : fmtAge(setup.createdAt)}</span>
      </div>
      {pct !== null ? (
        <div className="relative mt-1 h-1 w-full bg-line" title={`R saat ini ${fmtR(r)}`}>
          <span className="absolute inset-y-0 w-px bg-faint" style={{ left: `${(1 / 3) * 100}%` }} />
          <span className="absolute inset-y-0 w-px bg-up/60" style={{ left: `${(2.5 / 3) * 100}%` }} />
          <span className={`absolute inset-y-0 left-0 ${r !== null && r >= 0 ? 'bg-up' : 'bg-down'}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </button>
  );
}
