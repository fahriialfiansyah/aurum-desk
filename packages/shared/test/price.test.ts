import { describe, expect, test } from 'vitest';
import { formatPrice, pointsBetween, roundPrice } from '../src/price';

describe('roundPrice', () => {
  test('rounds to 0.01', () => {
    expect(roundPrice(3447.685)).toBe(3447.69);
    expect(roundPrice(3447.684)).toBe(3447.68);
  });
  test('handles the classic float edge case', () => {
    expect(roundPrice(1.005)).toBe(1.01);
  });
  test('throws on non-finite', () => {
    expect(() => roundPrice(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatPrice', () => {
  test('always shows two decimals', () => {
    expect(formatPrice(3450)).toBe('3450.00');
    expect(formatPrice(3450.5)).toBe('3450.50');
  });
});

describe('pointsBetween', () => {
  test('is symmetric and positive', () => {
    expect(pointsBetween(10, 12.5)).toBe(2.5);
    expect(pointsBetween(12.5, 10)).toBe(2.5);
  });
});
