'use client';

import type { Candle, Timeframe } from '@aurum/shared';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, type RefObject } from 'react';
import type { ChartPalette } from '@/lib/theme';
import type { PriceLineSpec, ZoneSpec } from './overlays';
import { candleOptions, chartOptions } from './theme-options';
import { ZonePrimitive } from './zone-primitive';

export type FocusRequest = { nonce: number; fromTime: number; toTime: number } | null;

export type UseChartArgs = {
  containerRef: RefObject<HTMLDivElement | null>;
  tf: Timeframe;
  candles: readonly Candle[];
  markers: SeriesMarker<Time>[];
  zones: ZoneSpec[];
  lines: PriceLineSpec[];
  palette: ChartPalette;
  focus: FocusRequest;
  onHoverZone?: (zoneId: string | null, point: { x: number; y: number } | null) => void;
};

const FOCUS_PADDING_BARS = 12;

function toBar(c: Candle): CandlestickData<UTCTimestamp> {
  return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}

/** Owns one lightweight-charts instance: candles, markers, zone primitives, theme-aware price lines. */
export function useChart(args: UseChartArgs): void {
  const { containerRef, tf, candles, markers, zones, lines, palette, focus, onHoverZone } = args;
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const zonesRef = useRef(new Map<string, ZonePrimitive>());
  const linesRef = useRef(new Map<string, IPriceLine>());
  const lastRef = useRef<{ tf: Timeframe; last: Candle | null; first: number | null }>({ tf, last: null, first: null });
  const hoverRef = useRef(onHoverZone);
  hoverRef.current = onHoverZone;

  // Create once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, chartOptions(palette));
    const series = chart.addSeries(CandlestickSeries, candleOptions(palette));
    // autoScale=false: marker margins are in pixels and would squash the price range on short charts.
    const markerPlugin = createSeriesMarkers(series, [], { zOrder: 'aboveSeries', autoScale: false });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markerPlugin;
    lastRef.current = { tf, last: null, first: null };

    const onMove = (param: MouseEventParams) => {
      const info = param.hoveredInfo;
      const id = info && info.objectKind === 'primitive' && typeof info.objectId === 'string' ? info.objectId : null;
      if (!param.point) {
        hoverRef.current?.(null, null);
        return;
      }
      hoverRef.current?.(id, { x: param.point.x, y: param.point.y });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      markersRef.current?.detach();
      zonesRef.current.clear();
      linesRef.current.clear();
      markersRef.current = null;
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- palette and tf are applied by the effects below
  }, [containerRef]);

  // Theme.
  useEffect(() => {
    chartRef.current?.applyOptions(chartOptions(palette));
    seriesRef.current?.applyOptions(candleOptions(palette));
  }, [palette]);

  // Candles: full reload on timeframe/snapshot change, incremental update on ticks.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const last = candles[candles.length - 1] ?? null;
    const first = candles[0]?.time ?? null;
    const prev = lastRef.current;
    const prevSecondLast = candles[candles.length - 2]?.time;
    const incremental =
      prev.tf === tf &&
      prev.last !== null &&
      last !== null &&
      (last.time === prev.last.time || (last.time > prev.last.time && prevSecondLast === prev.last.time));
    if (incremental) {
      series.update(toBar(last));
    } else {
      series.setData(candles.map(toBar));
      if (prev.tf !== tf || prev.first === null) chartRef.current?.timeScale().scrollToRealTime();
    }
    lastRef.current = { tf, last, first };
  }, [candles, tf]);

  // Markers (swings, BOS/CHoCH, copilot).
  useEffect(() => {
    markersRef.current?.setMarkers(markers);
  }, [markers]);

  // Zones: diff by id.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const current = zonesRef.current;
    const wanted = new Map(zones.map((z) => [z.box.id, z] as const));
    for (const [id, primitive] of current) {
      if (!wanted.has(id)) {
        series.detachPrimitive(primitive);
        current.delete(id);
      }
    }
    for (const [id, spec] of wanted) {
      const existing = current.get(id);
      if (existing) existing.setZone(spec.box, spec.style);
      else {
        const primitive = new ZonePrimitive(spec.box, spec.style);
        series.attachPrimitive(primitive);
        current.set(id, primitive);
      }
    }
  }, [zones]);

  // Price lines: diff by id.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const current = linesRef.current;
    const wanted = new Map(lines.map((l) => [l.id, l] as const));
    for (const [id, line] of current) {
      if (!wanted.has(id)) {
        series.removePriceLine(line);
        current.delete(id);
      }
    }
    for (const [id, spec] of wanted) {
      const options = {
        price: spec.price,
        color: spec.color,
        lineWidth: spec.lineWidth,
        lineStyle: spec.lineStyle,
        title: spec.title,
        axisLabelVisible: true,
        axisLabelColor: spec.axisLabelColor,
        axisLabelTextColor: spec.axisLabelTextColor,
      };
      const existing = current.get(id);
      if (existing) existing.applyOptions(options);
      else current.set(id, series.createPriceLine(options));
    }
  }, [lines]);

  // Focus: zoom to a setup's zone.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focus || candles.length === 0) return;
    const step = Math.max(60, (candles[1]?.time ?? 0) - (candles[0]?.time ?? 0) || 60);
    const from = Math.max(candles[0]!.time, focus.fromTime - FOCUS_PADDING_BARS * step);
    const to = Math.min(candles[candles.length - 1]!.time, focus.toTime + FOCUS_PADDING_BARS * step);
    try {
      chart.timeScale().setVisibleRange({ from: from as UTCTimestamp, to: to as UTCTimestamp });
    } catch {
      chart.timeScale().fitContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to a new focus request
  }, [focus?.nonce]);
}
