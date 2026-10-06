'use client';

import type { Zone } from '@aurum/shared';
import { fmtDateTime, formatPrice } from '@/lib/format';

type Props = { zone: Zone; point: { x: number; y: number } };

const ROWS: Array<[keyof Zone['scoreBreakdown'], string]> = [
  ['departure', 'Kekuatan departure'],
  ['freshness', 'Freshness'],
  ['structure', 'Konfluensi struktur'],
  ['age', 'Usia zona'],
];

/** Hover card with the zone's score breakdown (positioned inside the chart container). */
export function ZoneTooltip({ zone, point }: Props) {
  return (
    <div
      className="pointer-events-none absolute z-20 w-56 border border-line-strong bg-elev-2 p-2 text-[11px] shadow-lg fade-in"
      style={{ left: point.x + 14, top: point.y + 14 }}
      role="tooltip"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className={`font-semibold uppercase ${zone.type === 'demand' ? 'text-up' : 'text-down'}`}>
          {zone.type} · {zone.pattern}
        </span>
        <span className="tabular text-accent">skor {zone.score}</span>
      </div>
      <div className="tabular mb-1 text-muted">
        {formatPrice(zone.bottom)} – {formatPrice(zone.top)} · {zone.tf} · {zone.fresh ? 'fresh' : zone.tested ? `tested ×${zone.touches}` : 'invalid'}
      </div>
      <ul className="space-y-0.5">
        {ROWS.map(([key, label]) => (
          <li key={key} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-faint">{label}</span>
            <span className="h-1 flex-1 bg-line">
              <span className="block h-1 bg-accent" style={{ width: `${zone.scoreBreakdown[key]}%` }} />
            </span>
            <span className="tabular w-6 text-right">{zone.scoreBreakdown[key]}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-[10px] text-faint">dibuat {fmtDateTime(zone.createdAt)} WIB</div>
    </div>
  );
}
