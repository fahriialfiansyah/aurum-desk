'use client';

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type Time,
} from 'lightweight-charts';
import type { ChartPalette } from '@/lib/theme';

const WIB = 'Asia/Jakarta';
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { timeZone: WIB, hourCycle: 'h23', ...o });
const fYear = fmt({ year: 'numeric' });
const fMonth = fmt({ month: 'short' });
const fDay = fmt({ day: '2-digit', month: 'short' });
const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
const fFull = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Axis ticks in WIB while keeping true UTC timestamps on the scale. */
export function tickMarkFormatter(time: Time, type: TickMarkType): string | null {
  if (typeof time !== 'number') return null;
  const d = new Date(time * 1000);
  switch (type) {
    case TickMarkType.Year:
      return fYear.format(d);
    case TickMarkType.Month:
      return fMonth.format(d);
    case TickMarkType.DayOfMonth:
      return fDay.format(d);
    case TickMarkType.Time:
    case TickMarkType.TimeWithSeconds:
      return fTime.format(d).replace('.', ':');
    default:
      return null;
  }
}

export function crosshairTimeFormatter(time: Time): string {
  return typeof time === 'number' ? `${fFull.format(new Date(time * 1000)).replace(/\./g, ':')} WIB` : String(time);
}

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function chartOptions(p: ChartPalette): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: p.bg },
      textColor: p.text,
      fontSize: 11,
      fontFamily: FONT,
      attributionLogo: true,
    },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: p.crosshair, width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: p.crosshair },
      horzLine: { color: p.crosshair, width: 1, style: LineStyle.LargeDashed, labelBackgroundColor: p.crosshair },
    },
    rightPriceScale: { borderColor: p.grid, scaleMargins: { top: 0.12, bottom: 0.08 }, ticksVisible: false },
    timeScale: { borderColor: p.grid, timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7, tickMarkFormatter },
    localization: { locale: 'id-ID', priceFormatter: (v: number) => v.toFixed(2), timeFormatter: crosshairTimeFormatter },
    handleScale: { axisPressedMouseMove: { time: true, price: true } },
  };
}

export function candleOptions(p: ChartPalette): CandlestickSeriesPartialOptions {
  return {
    upColor: p.up,
    downColor: p.down,
    wickUpColor: p.up,
    wickDownColor: p.down,
    borderVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    priceLineVisible: true,
    priceLineColor: p.muted,
    priceLineStyle: LineStyle.Dotted,
    lastValueVisible: true,
  };
}
