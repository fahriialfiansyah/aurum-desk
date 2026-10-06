import { formatPrice, type Drawing, type MarketStructure, type Setup, type Zone } from '@aurum/shared';
import { LineStyle, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { ChartPalette } from '@/lib/theme';
import type { ZoneBox, ZoneStyle } from './zone-primitive';

export type ZoneSpec = { box: ZoneBox; style: ZoneStyle };

export type PriceLineSpec = {
  id: string;
  price: number;
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  lineStyle: LineStyle;
  title: string;
  axisLabelColor: string;
  axisLabelTextColor: string;
};

const CHOSEN_FILL_ALPHA = 0.14;
const RUNNER_UP_FILL_ALPHA = 0.06;
const OTHER_FILL_ALPHA = 0.05;

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? color.slice(1).split('').map((c) => c + c).join('') : color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/** Only the most recent markers carry text so the chart stays legible. */
export const LABELLED_SWINGS = 10;
export const LABELLED_EVENTS = 5;

/** HH/HL/LH/LL labels at confirmed swings (older swings are unlabelled dots). */
export function swingMarkers(structure: MarketStructure, p: ChartPalette): SeriesMarker<Time>[] {
  const labelled = structure.swings.filter((s) => s.label !== null);
  const firstLabelled = Math.max(0, labelled.length - LABELLED_SWINGS);
  return labelled.map((s, i) => ({
    time: s.time as UTCTimestamp,
    position: s.kind === 'high' ? 'aboveBar' : 'belowBar',
    shape: 'circle',
    color: p.muted,
    text: i >= firstLabelled ? (s.label ?? '') : '',
    size: 0,
  }));
}

/** BOS ▲/▼ and CHoCH markers at the breaking candle; only the latest events show kind + price. */
export function structureMarkers(structure: MarketStructure, p: ChartPalette): SeriesMarker<Time>[] {
  const firstLabelled = Math.max(0, structure.events.length - LABELLED_EVENTS);
  return structure.events.map((e, i) => ({
    time: e.time as UTCTimestamp,
    position: e.direction === 'bullish' ? 'belowBar' : 'aboveBar',
    shape: e.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
    color: e.kind === 'CHoCH' ? p.accent : e.direction === 'bullish' ? p.up : p.down,
    text: i >= firstLabelled ? `${e.kind} ${formatPrice(e.price)}` : '',
    size: i >= firstLabelled ? 1 : 0,
  }));
}

export function mergeMarkers(...groups: SeriesMarker<Time>[][]): SeriesMarker<Time>[] {
  return groups.flat().sort((a, b) => Number(a.time) - Number(b.time));
}

/**
 * Zone rectangles. The chosen zone gets the theme ink (black/white) border and a 14% fill;
 * runner-ups are dimmed; other zones are faint type-colored tints.
 */
export function zoneSpecs(
  zones: readonly Zone[],
  chosenZoneId: string | null,
  runnerUpIds: ReadonlySet<string>,
  p: ChartPalette,
): ZoneSpec[] {
  return zones.map((z) => {
    const typeColor = z.type === 'demand' ? p.up : p.down;
    const chosen = z.id === chosenZoneId;
    const runnerUp = runnerUpIds.has(z.id);
    const label = `${z.type === 'demand' ? 'DEMAND' : 'SUPPLY'} ${z.pattern} · ${z.score}`;
    const style: ZoneStyle = chosen
      ? { fillColor: withAlpha(p.ink, CHOSEN_FILL_ALPHA), borderColor: p.ink, borderWidth: 1, dashed: false, label, labelColor: p.ink, autoscale: true }
      : runnerUp
        ? { fillColor: withAlpha(typeColor, RUNNER_UP_FILL_ALPHA), borderColor: withAlpha(p.ink, 0.35), borderWidth: 1, dashed: true, label, labelColor: p.muted, autoscale: false }
        : { fillColor: withAlpha(typeColor, OTHER_FILL_ALPHA), borderColor: withAlpha(typeColor, 0.35), borderWidth: 1, dashed: true, label: z.fresh ? label : `${label} · tested`, labelColor: p.muted, autoscale: false };
    return { box: { id: z.id, fromTime: z.createdAt, toTime: null, top: z.top, bottom: z.bottom }, style };
  });
}

/** Entry / SL / TP1 / TP2 as black-or-white lines with exact 2-decimal price labels. */
export function levelLines(setup: Setup, p: ChartPalette): PriceLineSpec[] {
  const textOnInk = p.ink === '#ffffff' ? '#000000' : '#ffffff';
  const base = { color: p.ink, axisLabelColor: p.ink, axisLabelTextColor: textOnInk } as const;
  return [
    { id: `${setup.id}:entry`, price: setup.entry, lineWidth: 2, lineStyle: LineStyle.Solid, title: `ENTRY ${formatPrice(setup.entry)}`, ...base },
    { id: `${setup.id}:sl`, price: setup.stopLoss, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `SL ${formatPrice(setup.stopLoss)}`, ...base, axisLabelColor: p.down, axisLabelTextColor: '#ffffff' },
    { id: `${setup.id}:tp1`, price: setup.tp1, lineWidth: 1, lineStyle: LineStyle.Dotted, title: `TP1 ${formatPrice(setup.tp1)} (1:1.5)`, ...base, axisLabelColor: p.up, axisLabelTextColor: '#ffffff' },
    { id: `${setup.id}:tp2`, price: setup.tp2, lineWidth: 1, lineStyle: LineStyle.Dotted, title: `TP2 ${formatPrice(setup.tp2)} (1:2)`, ...base, axisLabelColor: p.up, axisLabelTextColor: '#ffffff' },
  ];
}

/** Copilot drawings → price lines / zone boxes. */
export function drawingSpecs(drawings: readonly Drawing[], p: ChartPalette): { lines: PriceLineSpec[]; zones: ZoneSpec[]; markers: SeriesMarker<Time>[] } {
  const lines: PriceLineSpec[] = [];
  const zones: ZoneSpec[] = [];
  const markers: SeriesMarker<Time>[] = [];
  for (const d of drawings) {
    if (d.kind === 'hline') {
      lines.push({
        id: `draw:${d.id}`,
        price: d.price,
        color: d.color ?? p.info,
        lineWidth: 1,
        lineStyle: d.style === 'solid' ? LineStyle.Solid : d.style === 'dotted' ? LineStyle.Dotted : LineStyle.Dashed,
        title: `${d.label ?? 'copilot'} ${formatPrice(d.price)}`,
        axisLabelColor: d.color ?? p.info,
        axisLabelTextColor: '#ffffff',
      });
    } else if (d.kind === 'box') {
      zones.push({
        box: { id: `draw:${d.id}`, fromTime: d.fromTime, toTime: d.toTime, top: d.top, bottom: d.bottom },
        style: { fillColor: withAlpha(d.color ?? p.info, 0.1), borderColor: d.color ?? p.info, borderWidth: 1, dashed: true, label: d.label ?? 'copilot', labelColor: d.color ?? p.info, autoscale: false },
      });
    } else {
      markers.push({ time: d.time as UTCTimestamp, position: d.position === 'above' ? 'aboveBar' : 'belowBar', shape: 'square', color: d.color ?? p.info, text: d.text, size: 1 });
    }
  }
  return { lines, zones, markers };
}

/** Setups whose lines belong on a chart of timeframe `tf`: the entry-TF chart and the bias-TF chart of the same playbook. */
export function setupsForChart(setups: readonly Setup[], tf: string, playbookTfs: { biasTf: string; entryTf: string }): Setup[] {
  const active = setups.filter((s) => !['tp2', 'stopped', 'invalidated', 'expired'].includes(s.status));
  if (tf !== playbookTfs.entryTf && tf !== playbookTfs.biasTf) return [];
  return active;
}
