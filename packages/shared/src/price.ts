/** XAUUSD is handled with 0.01 precision everywhere a level is computed or displayed. */
export const PRICE_DECIMALS = 2;
export const PRICE_PRECISION = 0.01;
export const PRICE_SCALE = 100;

/** Round to 0.01 without binary-float drift (e.g. 1.005 → 1.01). */
export function roundPrice(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundPrice: value must be finite, got ${String(value)}`);
  }
  return Math.round((value + Number.EPSILON * Math.sign(value)) * PRICE_SCALE) / PRICE_SCALE;
}

export function formatPrice(value: number): string {
  return roundPrice(value).toFixed(PRICE_DECIMALS);
}

/** Number of 0.01 points between two prices (always positive). */
export function pointsBetween(a: number, b: number): number {
  return roundPrice(Math.abs(a - b));
}
