import type { CompleteOptions, CompleteResult, LLMProvider, LlmMessage } from '../src/types';

/** Scripted provider: returns the queued results in order and records every call. */
export class FakeProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'fake-model';
  readonly calls: Array<{ messages: LlmMessage[]; options: CompleteOptions }> = [];
  constructor(private readonly queue: Array<Partial<CompleteResult> | Error>) {}

  async complete(messages: LlmMessage[], options: CompleteOptions = {}): Promise<CompleteResult> {
    this.calls.push({ messages, options });
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    const text = next?.text ?? '';
    for (const ch of text.match(/.{1,5}/g) ?? []) options.onToken?.(ch);
    return { text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end', model: this.model, ...next };
  }
}
