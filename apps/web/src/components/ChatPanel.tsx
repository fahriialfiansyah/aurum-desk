'use client';

import { newId, type ChatMessage } from '@aurum/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useDeskStore } from '@/store/desk-store';
import { Panel } from './Panel';

const SUGGESTIONS = ['kenapa setup ini valid?', 'bias M30 sekarang?', 'zona demand terdekat?', 'jalankan playbook B'];

export function ChatPanel() {
  const chat = useDeskStore((s) => s.chat);
  const streaming = useDeskStore((s) => s.chatStreaming);
  const addChatMessage = useDeskStore((s) => s.addChatMessage);
  const focusedSetupId = useDeskStore((s) => s.ui.focusedSetupId);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.length, streaming]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setBusy(true);
    const mine: ChatMessage = { id: newId('msg'), role: 'user', content: message, ts: new Date().toISOString() };
    addChatMessage(mine);
    setInput('');
    try {
      await api.chat(focusedSetupId ? `${message}\n\n[setup fokus: ${focusedSetupId}]` : message);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? 'Copilot belum aktif di server (fase P5).' : e instanceof Error ? e.message : 'gagal mengirim');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <Panel title="Copilot" right={<span>{streaming ? 'mengetik…' : 'Bahasa Indonesia'}</span>} className="h-full" bodyClassName="flex flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 scrollbar-thin-custom" data-testid="chat-messages">
        {chat.length === 0 ? (
          <div className="text-[11px] text-faint">
            Tanya apa saja tentang struktur, zona, atau setup. Copilot hanya memakai level dari engine — tidak pernah mengarang harga.
            <div className="mt-2 flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-line-strong hover:text-fg">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {chat.map((m) => (
          <div key={m.id} className={`max-w-full text-[11px] ${m.role === 'user' ? 'text-fg' : 'text-fg'}`}>
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-faint">
              {m.role === 'user' ? 'kamu' : 'copilot'}
              {m.source === 'rules' ? ' · rule-based' : ''}
            </div>
            {m.toolCalls && m.toolCalls.length > 0 ? (
              <div className="mb-1 flex flex-wrap gap-1">
                {m.toolCalls.map((t) => (
                  <span key={t.id} className={`border px-1 py-px text-[9px] ${t.status === 'error' ? 'border-down text-down' : t.status === 'done' ? 'border-line-strong text-muted' : 'border-accent text-accent'}`}>
                    ⚙ {t.name}
                    {t.status === 'running' ? '…' : ''}
                  </span>
                ))}
              </div>
            ) : null}
            <div className={`whitespace-pre-wrap border-l-2 pl-2 ${m.role === 'user' ? 'border-line-strong' : 'border-accent'}`}>{m.content || (streaming === m.id ? '▍' : '')}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-2 border-t border-line p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="tanya copilot…"
          className="h-7 min-w-0 flex-1 border border-line bg-bg px-2 text-[11px] outline-hidden focus:border-accent"
          aria-label="Pesan untuk copilot"
          maxLength={2000}
        />
        <button type="submit" disabled={busy || !input.trim()} className="h-7 border border-line px-3 text-[11px] text-muted hover:text-fg disabled:opacity-40">
          kirim
        </button>
      </form>
      {error ? <div className="border-t border-line px-3 py-1 text-[10px] text-warn">{error}</div> : null}
    </Panel>
  );
}
