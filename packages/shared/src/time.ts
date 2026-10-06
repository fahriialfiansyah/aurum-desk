export const DISPLAY_TIMEZONE = 'Asia/Jakarta';
export const DISPLAY_TZ_LABEL = 'WIB';
export const DISPLAY_TZ_OFFSET_SECONDS = 7 * 3600;

export function secToMs(sec: number): number {
  return sec * 1000;
}

export function msToSec(ms: number): number {
  return Math.floor(ms / 1000);
}

export function isoFromSec(sec: number): string {
  return new Date(secToMs(sec)).toISOString();
}

export function secFromIso(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO timestamp: ${iso}`);
  return msToSec(ms);
}

export function nowSec(): number {
  return msToSec(Date.now());
}

const wibFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: DISPLAY_TIMEZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const wibTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: DISPLAY_TIMEZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
});

/** "06/10/2026 13.45.00" style (id-ID locale) in WIB. */
export function formatWib(sec: number): string {
  return wibFormatter.format(new Date(secToMs(sec)));
}

/** "13.45" style in WIB (id-ID uses a dot between hours and minutes). */
export function formatWibTime(sec: number): string {
  return wibTimeFormatter.format(new Date(secToMs(sec)));
}
