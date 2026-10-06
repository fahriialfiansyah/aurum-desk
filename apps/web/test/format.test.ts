import { describe, expect, test } from 'vitest';
import { fmtAge, fmtDateTime, fmtR, fmtSigned, fmtTime, fmtTokens } from '@/lib/format';

describe('format helpers (WIB)', () => {
  test('times are shown in Asia/Jakarta', () => {
    const t = Date.UTC(2026, 9, 6, 3, 15) / 1000; // 03:15 UTC → 10:15 WIB
    expect(fmtTime(t)).toBe('10:15');
    expect(fmtDateTime(t)).toMatch(/06 Okt 10:15/);
  });
  test('signed numbers, R, tokens, age', () => {
    expect(fmtSigned(1.5)).toBe('+1.50');
    expect(fmtSigned(-0.25)).toBe('−0.25');
    expect(fmtR(null)).toBe('—');
    expect(fmtR(0.75)).toBe('+0.75R');
    expect(fmtTokens(1234)).toBe('1.2k');
    expect(fmtTokens(2_500_000)).toBe('2.50M');
    const now = Date.UTC(2026, 9, 6, 0, 0);
    expect(fmtAge(new Date(now - 90_000).toISOString(), now)).toBe('1m');
    expect(fmtAge(new Date(now - 7_200_000).toISOString(), now)).toBe('2j');
  });
});
