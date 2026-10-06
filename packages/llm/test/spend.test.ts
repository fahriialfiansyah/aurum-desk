import { describe, expect, test } from 'vitest';
import { estimateUsd, isPriced } from '../src/pricing';
import { SpendTracker } from '../src/spend';

describe('pricing', () => {
  test('known models are priced per MTok; ollama is free; unknown is 0 and flagged', () => {
    expect(estimateUsd('anthropic', 'claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24);
    expect(estimateUsd('openai', 'gpt-5-mini', 2_000_000, 0)).toBe(0.5);
    expect(estimateUsd('ollama', 'qwen3:8b', 1e6, 1e6)).toBe(0);
    expect(isPriced('anthropic', 'claude-x')).toBe(false);
    expect(isPriced('ollama', 'anything')).toBe(true);
  });
});

describe('SpendTracker', () => {
  test('enforces the per-cycle cap and the daily budget', () => {
    let now = Date.UTC(2026, 9, 6, 1, 0, 0);
    const t = new SpendTracker({ provider: 'anthropic', model: 'claude-opus-5-5', maxTokensPerCycle: 100, dailyBudgetTokens: 250 }, () => now);
    t.beginCycle();
    expect(t.canSpend()).toBe(true);
    t.record({ inputTokens: 60, outputTokens: 50 });
    expect(t.canSpend()).toBe(false); // cycle cap hit
    t.beginCycle();
    expect(t.canSpend()).toBe(true);
    t.record({ inputTokens: 100, outputTokens: 50 });
    expect(t.canSpend()).toBe(false); // daily budget hit (260 ≥ 250)
    expect(t.snapshot()).toMatchObject({ inputTokens: 160, outputTokens: 100, calls: 2, provider: 'anthropic', model: 'claude-opus-5-5' });
    expect(t.snapshot().estimatedUsd).toBeCloseTo((160 * 4 + 100 * 20) / 1e6, 3);
    now += 86_400_000; // next day resets the daily counters; a new cycle resets the cycle cap
    t.beginCycle();
    expect(t.canSpend()).toBe(true);
    expect(t.snapshot().calls).toBe(0);
  });
});
