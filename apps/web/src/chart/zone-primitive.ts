'use client';

import type {
  AutoscaleInfo,
  Coordinate,
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ITimeScaleApi,
  Logical,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';

type CanvasTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export type ZoneBox = {
  id: string;
  fromTime: number;
  /** null → extend to the right edge of the chart. */
  toTime: number | null;
  top: number;
  bottom: number;
};

export type ZoneStyle = {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  dashed: boolean;
  label: string;
  labelColor: string;
  /** Keep the zone inside the visible price range. */
  autoscale: boolean;
};

type XY = { x: Coordinate | null; y: Coordinate | null };
const OFFSCREEN = -100_000;

/** Pixel-perfect box from two media coordinates. */
function positionsBox(a: number, b: number, pixelRatio: number): { position: number; length: number } {
  const p1 = Math.round(pixelRatio * a);
  const p2 = Math.round(pixelRatio * b);
  return { position: Math.min(p1, p2), length: Math.abs(p2 - p1) + 1 };
}

function timeToX(ts: ITimeScaleApi<Time>, t: number): Coordinate | null {
  const direct = ts.timeToCoordinate(t as UTCTimestamp);
  if (direct !== null) return direct;
  const idx = ts.timeToIndex(t as UTCTimestamp, true);
  return idx === null ? null : ts.logicalToCoordinate(idx as unknown as Logical);
}

class ZoneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly p1: XY,
    private readonly p2: XY,
    private readonly style: ZoneStyle,
  ) {}

  draw(target: CanvasTarget): void {
    const { p1, p2, style } = this;
    if (p1.x === null || p1.y === null || p2.x === null || p2.y === null) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const h = positionsBox(p1.x!, p2.x!, hr);
      const v = positionsBox(p1.y!, p2.y!, vr);
      ctx.fillStyle = style.fillColor;
      ctx.fillRect(h.position, v.position, h.length, v.length);
      if (style.borderWidth > 0) {
        ctx.lineWidth = Math.max(1, Math.round(style.borderWidth * vr));
        ctx.strokeStyle = style.borderColor;
        ctx.setLineDash(style.dashed ? [4 * hr, 3 * hr] : []);
        const half = ctx.lineWidth / 2;
        ctx.strokeRect(h.position + half, v.position + half, h.length - ctx.lineWidth, v.length - ctx.lineWidth);
        ctx.setLineDash([]);
      }
    });
    if (style.label) {
      target.useMediaCoordinateSpace(({ context: ctx }) => {
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textBaseline = 'top';
        ctx.fillStyle = style.labelColor;
        ctx.fillText(style.label, Math.min(p1.x!, p2.x!) + 4, Math.min(p1.y!, p2.y!) + 3);
      });
    }
  }
}

class ZonePaneView implements IPrimitivePaneView {
  p1: XY = { x: null, y: null };
  p2: XY = { x: null, y: null };
  constructor(private readonly source: ZonePrimitive) {}

  update(): void {
    const { chart, series, zone } = this.source;
    const ts = chart.timeScale();
    const right = ts.width() as Coordinate;
    const x2 = zone.toTime === null ? right : (timeToX(ts, zone.toTime) ?? right);
    this.p1 = { x: timeToX(ts, zone.fromTime), y: series.priceToCoordinate(zone.top) };
    this.p2 = { x: x2, y: series.priceToCoordinate(zone.bottom) };
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer {
    return new ZoneRenderer(this.p1, this.p2, this.source.style);
  }
}

/** Filled rectangle with a theme-aware border, extended to the right edge. Hit-testable by zone id. */
export class ZonePrimitive implements ISeriesPrimitive<Time> {
  private chartApi: IChartApiBase<Time> | null = null;
  private seriesApi: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: ZonePaneView[] = [new ZonePaneView(this)];

  constructor(
    public zone: ZoneBox,
    public style: ZoneStyle,
  ) {}

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void {
    this.chartApi = chart;
    this.seriesApi = series;
    this.requestUpdate = requestUpdate;
  }

  detached(): void {
    this.chartApi = null;
    this.seriesApi = null;
    this.requestUpdate = null;
  }

  get chart(): IChartApiBase<Time> {
    if (!this.chartApi) throw new Error('ZonePrimitive belum terpasang');
    return this.chartApi;
  }

  get series(): ISeriesApi<SeriesType> {
    if (!this.seriesApi) throw new Error('ZonePrimitive belum terpasang');
    return this.seriesApi;
  }

  updateAllViews(): void {
    for (const v of this.views) v.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  autoscaleInfo(): AutoscaleInfo | null {
    return this.style.autoscale ? { priceRange: { minValue: this.zone.bottom, maxValue: this.zone.top } } : null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const v = this.views[0]!;
    if (v.p1.x === null || v.p2.x === null || v.p1.y === null || v.p2.y === null) return null;
    const inside = x >= Math.min(v.p1.x, v.p2.x) && x <= Math.max(v.p1.x, v.p2.x) && y >= Math.min(v.p1.y, v.p2.y) && y <= Math.max(v.p1.y, v.p2.y);
    return inside ? { externalId: this.zone.id, zOrder: 'bottom', cursorStyle: 'pointer' } : null;
  }

  setZone(zone: ZoneBox, style: ZoneStyle): void {
    this.zone = zone;
    this.style = style;
    this.requestUpdate?.();
  }
}

export { OFFSCREEN };
