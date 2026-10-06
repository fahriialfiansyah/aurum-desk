import { getCandles, type Db } from '@aurum/db';
import { isoFromSec } from '@aurum/shared';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const CSV_HEADER = 'time,open,high,low,close,volume';
const PAGE = 20_000;

/** Writes M1 candles in [fromSec, toSec] to a CSV used by the replay provider and fixtures. Returns row count. */
export async function exportCsv(
  db: Db,
  args: { symbol: string; source: string; fromSec: number; toSec: number; outPath: string },
): Promise<number> {
  await mkdir(dirname(args.outPath), { recursive: true });
  const stream = createWriteStream(args.outPath, { encoding: 'utf8' });
  stream.write(`${CSV_HEADER}\n`);
  let cursor = args.fromSec;
  let total = 0;
  for (;;) {
    const page = await getCandles(db, {
      symbol: args.symbol,
      source: args.source,
      tf: 'M1',
      fromSec: cursor,
      toSec: args.toSec,
      limit: PAGE,
      order: 'asc',
    });
    for (const c of page) {
      stream.write(`${isoFromSec(c.time)},${c.open},${c.high},${c.low},${c.close},${c.volume}\n`);
    }
    total += page.length;
    const last = page[page.length - 1];
    if (!last || page.length < PAGE) break;
    cursor = last.time + 60;
  }
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.end(() => resolve());
  });
  return total;
}
