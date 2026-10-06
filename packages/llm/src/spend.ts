import type { LlmProviderName, LlmUsage } from './types';
import { estimateUsd } from './pricing';

export type SpendSnapshot = {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  estimatedUsd: number;
  dailyBudgetTokens: number;
  provider: string;
  model: string | null;
  /** Tokens used in the current candle-close cycle. */
  cycleTokens: number;
};

const DAY_MS = 86_400_000;

/**
 * Token/cost accounting with a per-cycle cap and a soft daily budget.
 * The orchestrator calls `beginCycle()` on every candle-close batch and asks
 * `canSpend()` before each LLM call.
 */
export class SpendTracker {
  private input = 0;
  private output = 0;
  private calls = 0;
  private usd = 0;
  private cycle = 0;
  private dayStart: number;
  private readonly now: () => number;

  constructor(
    private readonly config: { provider: LlmProviderName | 'none'; model: string | null; maxTokensPerCycle: number; dailyBudgetTokens: number },
    now: () => number = Date.now,
  ) {
    this.now = now;
    this.dayStart = Math.floor(now() / DAY_MS) * DAY_MS;
  }

  beginCycle(): void {
    this.rollDay();
    this.cycle = 0;
  }

  /** True while this cycle is under the hard cap and the day is under the soft budget. */
  canSpend(): boolean {
    this.rollDay();
    return this.cycle < this.config.maxTokensPerCycle && this.input + this.output < this.config.dailyBudgetTokens;
  }

  record(usage: LlmUsage, model: string = this.config.model ?? ''): void {
    this.rollDay();
    const total = usage.inputTokens + usage.outputTokens;
    this.input += usage.inputTokens;
    this.output += usage.outputTokens;
    this.calls += 1;
    this.cycle += total;
    if (this.config.provider !== 'none') this.usd += estimateUsd(this.config.provider, model, usage.inputTokens, usage.outputTokens);
  }

  snapshot(): SpendSnapshot {
    this.rollDay();
    return {
      inputTokens: this.input,
      outputTokens: this.output,
      calls: this.calls,
      estimatedUsd: Math.round(this.usd * 10_000) / 10_000,
      dailyBudgetTokens: this.config.dailyBudgetTokens,
      provider: this.config.provider,
      model: this.config.model,
      cycleTokens: this.cycle,
    };
  }

  private rollDay(): void {
    const start = Math.floor(this.now() / DAY_MS) * DAY_MS;
    if (start !== this.dayStart) {
      this.dayStart = start;
      this.input = 0;
      this.output = 0;
      this.calls = 0;
      this.usd = 0;
    }
  }
}
