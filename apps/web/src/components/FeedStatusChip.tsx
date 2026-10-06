'use client';

import type { FeedStatus } from '@aurum/shared';
import type { ConnectionStatus } from '@/store/desk-store';

type Props = { feed: FeedStatus | null; connection: ConnectionStatus };

export function FeedStatusChip({ feed, connection }: Props) {
  const live = connection === 'open' && feed?.connected;
  const dotClass = connection !== 'open' ? 'bg-down' : live ? 'bg-up pulse-dot' : 'bg-warn';
  const label = connection !== 'open' ? (connection === 'connecting' ? 'menghubungkan…' : 'terputus') : feed ? `${feed.provider} · ${feed.source}` : '—';
  return (
    <div className="flex items-center gap-2" title={feed?.message ?? ''}>
      {feed?.isMock ? (
        <span className="rounded-xs bg-down px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white" data-testid="mock-badge">
          MOCK DATA
        </span>
      ) : null}
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
      <span className="max-w-[220px] truncate text-[11px] text-muted" data-testid="feed-label">
        {label}
      </span>
    </div>
  );
}
