import { formatPrice as sharedFormatPrice } from '@aurum/shared';

export const formatPrice = sharedFormatPrice;

const WIB = 'Asia/Jakarta';
const timeFmt = new Intl.DateTimeFormat('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const timeSecFmt = new Intl.DateTimeFormat('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dateTimeFmt = new Intl.DateTimeFormat('id-ID', { timeZone: WIB, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "13.45" in WIB from unix seconds or ISO. */
export function fmtTime(input: number | string): string {
  return timeFmt.format(toDate(input)).replace('.', ':');
}

export function fmtTimeSec(input: number | string): string {
  return timeSecFmt.format(toDate(input)).replace(/\./g, ':');
}

/** "06 Okt 13:45" in WIB. */
export function fmtDateTime(input: number | string): string {
  return dateTimeFmt
    .format(toDate(input))
    .replace(',', '')
    .replace(/(\d{2})\.(\d{2})$/, '$1:$2');
}

function toDate(input: number | string): Date {
  return typeof input === 'number' ? new Date(input * 1000) : new Date(input);
}

export function fmtSigned(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

export function fmtPct(value: number | null, decimals = 0): string {
  return value === null ? '—' : `${(value * 100).toFixed(decimals)}%`;
}

export function fmtR(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${fmtSigned(value, 2)}R`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Relative age like "12d" / "3j" / "5m" (Indonesian abbreviations). */
export function fmtAge(fromIso: string, nowMs = Date.now()): string {
  const sec = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  if (sec < 60) return `${sec}d`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}j`;
  return `${Math.floor(sec / 86_400)}h`;
}
