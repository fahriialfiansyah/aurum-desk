'use client';

import { miniTimeframe, useDeskStore } from '@/store/desk-store';
import { ChartCanvas } from './ChartCanvas';
import { useChartInputs } from './MainChart';

/** Secondary chart: the other timeframe of the active playbook (M15 under M30, M5 under M15). */
export function MiniChart() {
  const tf = useDeskStore((s) => s.ui.tf);
  const playbook = useDeskStore((s) => s.ui.playbook);
  const miniTf = miniTimeframe(tf, playbook);
  const inputs = useChartInputs(miniTf, playbook, { showSwings: false, showStructure: true, showZones: true, showLevels: true });
  return (
    <section className="flex h-[200px] shrink-0 flex-col border border-t-0 border-line bg-elev">
      <div className="flex h-6 shrink-0 items-center gap-3 border-b border-line px-3 text-[10px] text-muted">
        <span className="text-accent">{miniTf}</span>
        <span>
          struktur <b className={inputs.analysis?.structure.trend === 'bullish' ? 'text-up' : inputs.analysis?.structure.trend === 'bearish' ? 'text-down' : 'text-muted'}>{inputs.analysis?.structure.trend ?? '—'}</b>
        </span>
        <span>zona {inputs.analysis?.zones.length ?? 0}</span>
      </div>
      <div className="relative min-h-0 flex-1" data-testid="mini-chart">
        <ChartCanvas tf={miniTf} candles={inputs.candles} markers={inputs.markers} zones={inputs.zones} lines={inputs.lines} palette={inputs.palette} focus={inputs.focus} />
      </div>
    </section>
  );
}
