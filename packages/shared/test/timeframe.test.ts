import { describe, expect, test } from 'vitest';
import { bucketStart, isLastM1OfBucket } from '../src/timeframe';

// 2025-09-01 10:17:00 UTC
const T = Date.UTC(2025, 8, 1, 10, 17) / 1000;

describe('bucketStart', () => {
  test('M5 bucket starts at 10:15', () => {
    expect(bucketStart(T, 'M5')).toBe(Date.UTC(2025, 8, 1, 10, 15) / 1000);
  });
  test('M15 bucket starts at 10:15', () => {
    expect(bucketStart(T, 'M15')).toBe(Date.UTC(2025, 8, 1, 10, 15) / 1000);
  });
  test('M30 bucket starts at 10:00', () => {
    expect(bucketStart(T, 'M30')).toBe(Date.UTC(2025, 8, 1, 10, 0) / 1000);
  });
  test('M1 bucket is the minute itself', () => {
    expect(bucketStart(T, 'M1')).toBe(T);
  });
});

describe('isLastM1OfBucket', () => {
  test('10:29 closes the 10:00 M30 bucket', () => {
    expect(isLastM1OfBucket(Date.UTC(2025, 8, 1, 10, 29) / 1000, 'M30')).toBe(true);
  });
  test('10:28 does not close the M30 bucket', () => {
    expect(isLastM1OfBucket(Date.UTC(2025, 8, 1, 10, 28) / 1000, 'M30')).toBe(false);
  });
  test('10:04 closes the 10:00 M5 bucket', () => {
    expect(isLastM1OfBucket(Date.UTC(2025, 8, 1, 10, 4) / 1000, 'M5')).toBe(true);
  });
  test('10:14 closes the 10:00 M15 bucket', () => {
    expect(isLastM1OfBucket(Date.UTC(2025, 8, 1, 10, 14) / 1000, 'M15')).toBe(true);
  });
});
