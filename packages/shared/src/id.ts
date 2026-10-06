/** Short, URL-safe, time-sortable-ish id with a readable prefix (e.g. "stp_01HZ..."). */
export function newId(prefix: string): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}
