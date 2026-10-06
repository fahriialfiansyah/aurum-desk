import type { PlaybookId } from '@aurum/shared';
import { API_TOKEN, API_URL } from './config';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}` } : {}), ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new ApiError(0, `Server tidak terjangkau (${error instanceof Error ? error.message : 'network error'})`);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  return body;
}

export const api = {
  runPlaybook: (playbook: PlaybookId) => request<{ playbook: PlaybookId; reasons: string[]; best: unknown }>('/api/playbook/run', { method: 'POST', body: JSON.stringify({ playbook }) }),
  replay: (action: 'play' | 'pause' | 'restart') => request<{ ok: true }>(`/api/replay/${action}`, { method: 'POST' }),
  replaySpeed: (speed: number) => request<{ ok: true }>('/api/replay/speed', { method: 'POST', body: JSON.stringify({ speed }) }),
  chat: (message: string, conversationId?: string) =>
    request<{ ok: true; messageId: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),
  config: () => request<{ symbol: string; provider: string; isMock: boolean; llmProvider: string; replay: boolean }>('/api/config'),
};
