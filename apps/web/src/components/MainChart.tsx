'use client';

import { PLAYBOOKS, TIMEFRAMES, type PlaybookId, type Timeframe } from '@aurum/shared';
import { useCallback, useMemo } from 'react';
import { drawingSpecs, levelLines, mergeMarkers, setupsForChart, structureMarkers, swingMarkers, zoneSpecs } from '@/chart/overlays';
import type { FocusRequest } from '@/chart/use-chart';
import { chartPalette, useTheme } from '@/lib/theme';
import { formatPrice } from '@/lib/format';
import { useDeskStore, type Layer } from '@/store/desk-store';
import { ChartCanvas } from './ChartCanvas';
import { ZoneTooltip } from './ZoneTooltip';

const LAYER_LABELS: Record<Layer, string> = { swings: 'swing', structure: 'BOS/CHoCH', zones: 'zona', levels: 'level' };

function Tab({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-7 border-r border-line px-3 text-[11px] tracking-wider ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'}`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/** Builds the chart inputs for a timeframe: markers, zones, lines, focus. Shared by the main and mini charts. */
export function useChartInputs(tf: Timeframe, playbook: PlaybookId, options: { showSwings: boolean; showStructure: boolean; showZones: boolean; showLevels: boolean }) {
  const theme = useTheme((s) => s.theme);
  const palette = useMemo(() => chartPalette(theme), [theme]);
  const candles = useDeskStore((s) => s.candles[tf]);
  const analysis = useDeskStore((s) => s.analysis[tf]);
  const setups = useDeskStore((s) => s.setups);
  const drawings = useDeskStore((s) => s.drawings);
  const focusedSetupId = useDeskStore((s) => s.ui.focusedSetupId);
  const focusNonce = useDeskStore((s) => s.ui.focusNonce);

  const { biasTf, entryTf } = PLAYBOOKS[playbook];
  const chartSetups = useMemo(() => setupsForChart(setups, tf, { biasTf, entryTf }).filter((s) => s.playbook === playbook), [setups, tf, biasTf, entryTf, playbook]);
  const chosen = useMemo(() => chartSetups.find((s) => s.id === focusedSetupId) ?? chartSetups[0] ?? null, [chartSetups, focusedSetupId]);
  const runnerUpIds = useMemo(() => new Set(chartSetups.filter((s) => s.id !== chosen?.id).map((s) => s.zone.id)), [chartSetups, chosen]);
  const drawingLayer = useMemo(() => drawingSpecs(drawings.filter((d) => !d.tf || d.tf === tf), palette), [drawings, tf, palette]);

  const markers = useMemo(
    () =>
      mergeMarkers(
        analysis && options.showSwings ? swingMarkers(analysis.structure, palette) : [],
        analysis && options.showStructure ? structureMarkers(analysis.structure, palette) : [],
        drawingLayer.markers,
      ),
    [analysis, options.showSwings, options.showStructure, palette, drawingLayer.markers],
  );
  const zones = useMemo(
    () => [...(analysis && options.showZones ? zoneSpecs(analysis.zones, chosen?.zone.id ?? null, runnerUpIds, palette) : []), ...drawingLayer.zones],
    [analysis, options.showZones, chosen, runnerUpIds, palette, drawingLayer.zones],
  );
  const lines = useMemo(
    () => [...(chosen && options.showLevels ? levelLines(chosen, palette) : []), ...drawingLayer.lines],
    [chosen, options.showLevels, palette, drawingLayer.lines],
  );
  const focus = useMemo<FocusRequest>(() => {
    if (!chosen || !focusedSetupId || chosen.id !== focusedSetupId) return null;
    const zone = analysis?.zones.find((z) => z.id === chosen.zone.id);
    const last = candles[candles.length - 1]?.time ?? 0;
    return { nonce: focusNonce, fromTime: zone?.createdAt ?? Date.parse(chosen.createdAt) / 1000, toTime: last };
  }, [chosen, focusedSetupId, focusNonce, analysis, candles]);

  return { palette, candles, analysis, markers, zones, lines, focus, chosen };
}

export function MainChart() {
  const tf = useDeskStore((s) => s.ui.tf);
  const playbook = useDeskStore((s) => s.ui.playbook);
  const layers = useDeskStore((s) => s.ui.layers);
  const setTf = useDeskStore((s) => s.setTf);
  const setPlaybook = useDeskStore((s) => s.setPlaybook);
  const toggleLayer = useDeskStore((s) => s.toggleLayer);
  const hoveredZoneId = useDeskStore((s) => s.ui.hoveredZoneId);
  const hoverPoint = useDeskStore((s) => s.ui.hoverPoint);
  const setHoveredZone = useDeskStore((s) => s.setHoveredZone);
  const inputs = useChartInputs(tf, playbook, { showSwings: layers.swings, showStructure: layers.structure, showZones: layers.zones, showLevels: layers.levels });
  const onHoverZone = useCallback((id: string | null, point: { x: number; y: number } | null) => setHoveredZone(id, point), [setHoveredZone]);
  const hoveredZone = hoveredZoneId ? inputs.analysis?.zones.find((z) => z.id === hoveredZoneId) : undefined;
  const bias = inputs.analysis?.structure;

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-line bg-elev">
      <div className="flex h-7 shrink-0 items-stretch border-b border-line">
        <div className="flex items-stretch" role="tablist" aria-label="Timeframe">
          {TIMEFRAMES.map((t, i) => (
            <Tab key={t} active={t === tf} onClick={() => setTf(t)} title={`Timeframe ${t} (${i + 1})`}>
              {t}
            </Tab>
          ))}
        </div>
        <div className="flex items-stretch border-l border-line" role="tablist" aria-label="Playbook">
          {(Object.keys(PLAYBOOKS) as PlaybookId[]).map((id) => (
            <Tab key={id} active={id === playbook} onClick={() => setPlaybook(id)} title={`${PLAYBOOKS[id].label} (${PLAYBOOKS[id].shortLabel})`}>
              {`${PLAYBOOKS[id].shortLabel} · ${PLAYBOOKS[id].biasTf}→${PLAYBOOKS[id].entryTf}`}
            </Tab>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 px-2">
          {(Object.keys(LAYER_LABELS) as Layer[]).map((layer) => (
            <button
              key={layer}
              type="button"
              onClick={() => toggleLayer(layer)}
              className={`h-5 border px-1.5 text-[10px] ${layers[layer] ? 'border-line-strong text-fg' : 'border-line text-faint line-through'}`}
              aria-pressed={layers[layer]}
            >
              {LAYER_LABELS[layer]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 border-b border-line px-3 text-[10px] text-muted">
        <span>
          {tf} · struktur{' '}
          <b className={bias?.trend === 'bullish' ? 'text-up' : bias?.trend === 'bearish' ? 'text-down' : 'text-muted'}>{bias?.trend ?? '—'}</b>
        </span>
        <span>
          event terakhir{' '}
          <b className="text-fg">{bias?.lastEvent ? `${bias.lastEvent.kind} ${bias.lastEvent.direction === 'bullish' ? '▲' : '▼'} ${formatPrice(bias.lastEvent.price)}` : '—'}</b>
        </span>
        <span>
          zona <b className="text-fg">{inputs.analysis?.zones.length ?? 0}</b>
        </span>
        <span>
          ATR <b className="tabular text-fg">{inputs.analysis?.atr != null ? inputs.analysis.atr.toFixed(2) : '—'}</b>
        </span>
        {inputs.chosen ? (
          <span className="ml-auto truncate">
            setup <b className="text-ink">{inputs.chosen.direction.toUpperCase()}</b> @ {formatPrice(inputs.chosen.entry)} · {inputs.chosen.status}
          </span>
        ) : (
          <span className="ml-auto text-faint">belum ada setup untuk playbook ini</span>
        )}
      </div>
      <div className="relative min-h-0 flex-1" data-testid="main-chart">
        <ChartCanvas
          tf={tf}
          candles={inputs.candles}
          markers={inputs.markers}
          zones={inputs.zones}
          lines={inputs.lines}
          palette={inputs.palette}
          focus={inputs.focus}
          onHoverZone={onHoverZone}
        />
        {hoveredZone && hoverPoint ? <ZoneTooltip zone={hoveredZone} point={hoverPoint} /> : null}
      </div>
    </section>
  );
}
