import { CandleSchema, type Candle } from '@aurum/shared';
import { readFile } from 'node:fs/promises';

const MS_THRESHOLD = 1e11; // timestamps above this are milliseconds

function parseTime(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n > MS_THRESHOLD ? Math.floor(n / 1000) : n;
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) throw new Error(`Timestamp CSV tidak valid: "${raw}"`);
  return Math.floor(ms / 1000);
}

/**
 * Parses `time,open,high,low,close,volume` (ISO, unix seconds or ms) — also the Dukascopy CLI
 * `timestamp,...` layout. Invalid rows throw: replay data must be real and clean.
 */
export function parseCandleCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0];
  if (!header) throw new Error('CSV kosong');
  const cols = header.split(',').map((c) => c.trim().toLowerCase());
  const idx = (names: string[]) => {
    const i = cols.findIndex((c) => names.includes(c));
    if (i < 0) throw new Error(`Kolom ${names[0]} tidak ditemukan di header CSV: ${header}`);
    return i;
  };
  const iTime = idx(['time', 'timestamp', 'ts', 'datetime']);
  const iOpen = idx(['open']);
  const iHigh = idx(['high']);
  const iLow = idx(['low']);
  const iClose = idx(['close']);
  const iVolume = cols.findIndex((c) => c === 'volume' || c === 'vol' || c === 'tickvol');

  const byTime = new Map<number, Candle>();
  for (let n = 1; n < lines.length; n += 1) {
    const parts = lines[n]!.split(',');
    const candle = CandleSchema.parse({
      time: parseTime(parts[iTime] ?? ''),
      open: Number(parts[iOpen]),
      high: Number(parts[iHigh]),
      low: Number(parts[iLow]),
      close: Number(parts[iClose]),
      volume: iVolume >= 0 ? Number(parts[iVolume] ?? 0) : 0,
    });
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export async function loadCandleCsv(path: string): Promise<Candle[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Tidak bisa membaca file replay ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const candles = parseCandleCsv(text);
  if (candles.length === 0) throw new Error(`File replay ${path} tidak berisi candle`);
  return candles;
}
