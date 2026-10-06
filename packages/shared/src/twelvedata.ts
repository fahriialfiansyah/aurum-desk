import { z } from 'zod';
import { CandleSchema, type Candle } from './candle';
import { TIMEFRAME_SECONDS } from './timeframe';

export const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com';
export const TWELVEDATA_SYMBOL = 'XAU/USD';
export const TWELVEDATA_MAX_OUTPUTSIZE = 5000;

export class TwelveDataError extends Error {
  override readonly name = 'TwelveDataError';
  readonly code: number;
  constructor(code: number, message: string) {
    super(`Twelve Data ${code}: ${message}`);
    this.code = code;
  }
  get isRateLimit(): boolean {
    return this.code === 429;
  }
}

const valueSchema = z.object({
  datetime: z.string(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string().optional(),
});

const responseSchema = z.object({
  status: z.enum(['ok', 'error']).optional(),
  code: z.number().optional(),
  message: z.string().optional(),
  values: z.array(valueSchema).optional(),
});

const priceSchema = z.object({ price: z.string().optional(), status: z.string().optional(), code: z.number().optional(), message: z.string().optional() });

/** "YYYY-MM-DD HH:mm:ss" in UTC → unix seconds. */
export function parseTwelveDataTime(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) throw new TwelveDataError(0, `format datetime tidak dikenal: ${text}`);
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)) / 1000;
}

function formatTwelveDataTime(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

export type TwelveDataOptions = { apiKey: string; symbol?: string; baseUrl?: string; fetchImpl?: typeof fetch };

export type TimeSeriesArgs = {
  fromSec?: number;
  toSec?: number;
  outputsize?: number;
  /** Bars whose open + 60 s is after `nowSec` are still forming; they are dropped unless this is true. */
  includeForming?: boolean;
  nowSec?: number;
};

/** Thin, validated client for the `time_series` and `price` endpoints (M1 only). */
export class TwelveDataClient {
  private readonly apiKey: string;
  private readonly symbol: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TwelveDataOptions) {
    this.apiKey = options.apiKey;
    this.symbol = options.symbol ?? TWELVEDATA_SYMBOL;
    this.baseUrl = (options.baseUrl ?? TWELVEDATA_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Ascending M1 candles. Volume is absent for XAU/USD on Twelve Data, so it is 0. */
  async timeSeries(args: TimeSeriesArgs = {}): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol: this.symbol,
      interval: '1min',
      timezone: 'UTC',
      order: 'ASC',
      format: 'JSON',
      outputsize: String(Math.min(args.outputsize ?? TWELVEDATA_MAX_OUTPUTSIZE, TWELVEDATA_MAX_OUTPUTSIZE)),
      apikey: this.apiKey,
    });
    if (args.fromSec !== undefined) params.set('start_date', formatTwelveDataTime(args.fromSec));
    if (args.toSec !== undefined) params.set('end_date', formatTwelveDataTime(args.toSec));
    const body = await this.get(`/time_series?${params.toString()}`);
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new TwelveDataError(0, 'respons time_series tidak valid');
    if (parsed.data.status === 'error') throw new TwelveDataError(parsed.data.code ?? 0, parsed.data.message ?? 'unknown error');
    const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
    const candles = (parsed.data.values ?? []).map((v) =>
      CandleSchema.parse({
        time: parseTwelveDataTime(v.datetime),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: v.volume ? Number(v.volume) : 0,
      }),
    );
    const sorted = candles.sort((a, b) => a.time - b.time);
    return args.includeForming ? sorted : sorted.filter((c) => c.time + TIMEFRAME_SECONDS.M1 <= nowSec);
  }

  async price(): Promise<number> {
    const params = new URLSearchParams({ symbol: this.symbol, apikey: this.apiKey });
    const body = await this.get(`/price?${params.toString()}`);
    const parsed = priceSchema.safeParse(body);
    if (!parsed.success || parsed.data.status === 'error' || !parsed.data.price) {
      throw new TwelveDataError(parsed.success ? (parsed.data.code ?? 0) : 0, parsed.success ? (parsed.data.message ?? 'tanpa harga') : 'respons price tidak valid');
    }
    return Number(parsed.data.price);
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: { accept: 'application/json' } });
    } catch (error) {
      throw new TwelveDataError(0, `koneksi gagal: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body: unknown = await response.json().catch(() => ({}));
    const asError = responseSchema.safeParse(body);
    if (!response.ok) {
      const message = asError.success ? (asError.data.message ?? response.statusText) : response.statusText;
      throw new TwelveDataError(asError.success ? (asError.data.code ?? response.status) : response.status, message);
    }
    return body;
  }
}
