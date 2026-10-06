import { describe, expect, test } from 'vitest';
import { parseCandleCsv } from '../src/providers/csv';

describe('parseCandleCsv', () => {
  test('parses ISO timestamps', () => {
    const out = parseCandleCsv('time,open,high,low,close,volume\n2025-09-01T00:00:00.000Z,1,2,0.5,1.5,3\n');
    expect(out).toEqual([{ time: 1_756_684_800, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }]);
  });

  test('parses the Dukascopy CLI layout (ms timestamps) and sorts/dedupes', () => {
    const text = ['timestamp,open,high,low,close,volume', '1756684860000,2,3,1,2.5,1', '1756684800000,1,2,0.5,1.5,3', '1756684800000,1,2,0.5,1.6,3'].join('\n');
    const out = parseCandleCsv(text);
    expect(out.map((c) => c.time)).toEqual([1_756_684_800, 1_756_684_860]);
    expect(out[0]?.close).toBe(1.6);
  });

  test('accepts unix seconds', () => {
    expect(parseCandleCsv('time,open,high,low,close\n1756684800,1,2,0.5,1.5')[0]?.volume).toBe(0);
  });

  test('throws on invalid rows instead of silently skipping', () => {
    expect(() => parseCandleCsv('time,open,high,low,close,volume\n2025-09-01T00:00:00Z,1,0.9,0.5,1.5,3')).toThrow();
    expect(() => parseCandleCsv('time,open,high,low,close,volume\nnot-a-date,1,2,0.5,1.5,3')).toThrow(/Timestamp/);
    expect(() => parseCandleCsv('foo,bar\n1,2')).toThrow(/Kolom/);
    expect(() => parseCandleCsv('')).toThrow(/kosong/);
  });
});
