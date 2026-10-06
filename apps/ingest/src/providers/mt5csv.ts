import { CandleSchema, type Candle, type HistoricalDataProvider } from '@aurum/shared';
import { readFile } from 'node:fs/promises';

/**
 * MetaTrader 5 "Export Bars" format: TAB-separated, header `<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>`,
 * dates `YYYY.MM.DD`, times `HH:MM:SS` in BROKER SERVER TIME (not UTC). `offsetMinutes` is server − UTC
 * (e.g. 120 for EET, 180 for EEST); daily exports omit `<TIME>`.
 */
export function parseMt5Csv(text: string, offsetMinutes: number): Candle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0];
  if (!header) throw new Error('File MT5 kosong');
  const sep = header.includes('\t') ? '\t' : ',';
  const cols = header.split(sep).map((h) => h.replace(/[<>]/g, '').trim().toLowerCase());
  const idx = (name: string) => cols.indexOf(name);
  const iDate = idx('date');
  const iTime = idx('time');
  const iOpen = idx('open');
  const iHigh = idx('high');
  const iLow = idx('low');
  const iClose = idx('close');
  const iVol = idx('tickvol') >= 0 ? idx('tickvol') : idx('vol');
  if (iDate < 0 || iOpen < 0 || iHigh < 0 || iLow < 0 || iClose < 0) {
    throw new Error(`Header MT5 tidak dikenal: ${header}`);
  }
  const offsetSec = offsetMinutes * 60;
  const byTime = new Map<number, Candle>();
  for (let n = 1; n < lines.length; n += 1) {
    const f = lines[n]!.split(sep);
    const [y, m, d] = (f[iDate] ?? '').split('.').map(Number);
    const [hh = 0, mm = 0, ss = 0] = iTime >= 0 ? (f[iTime] ?? '00:00:00').split(':').map(Number) : [0, 0, 0];
    if (!y || !m || !d) throw new Error(`Baris ${n + 1}: tanggal tidak valid "${f[iDate]}"`);
    const serverSec = Date.UTC(y, m - 1, d, hh, mm, ss) / 1000;
    const candle = CandleSchema.parse({
      time: serverSec - offsetSec,
      open: Number(f[iOpen]),
      high: Number(f[iHigh]),
      low: Number(f[iLow]),
      close: Number(f[iClose]),
      volume: iVol >= 0 ? Number(f[iVol] ?? 0) : 0,
    });
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Broker-exact prices from an MT5 export file; the whole file is parsed once and sliced per request. */
export class Mt5CsvProvider implements HistoricalDataProvider {
  readonly name = 'mt5csv' as const;
  readonly unofficial = false;
  private cache: Candle[] | null = null;

  constructor(private readonly options: { path: string; offsetMinutes: number }) {}

  async load(): Promise<Candle[]> {
    if (this.cache) return this.cache;
    const text = await readFile(this.options.path, 'utf8');
    this.cache = parseMt5Csv(text, this.options.offsetMinutes);
    return this.cache;
  }

  async fetchHistory(from: Date, to: Date): Promise<Candle[]> {
    const a = from.getTime() / 1000;
    const b = to.getTime() / 1000;
    return (await this.load()).filter((c) => c.time >= a && c.time < b);
  }

  async range(): Promise<{ fromSec: number; toSec: number } | null> {
    const all = await this.load();
    const first = all[0];
    const last = all[all.length - 1];
    return first && last ? { fromSec: first.time, toSec: last.time + 60 } : null;
  }
}
