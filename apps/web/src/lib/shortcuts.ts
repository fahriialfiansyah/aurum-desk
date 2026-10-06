'use client';

import type { PlaybookId, Timeframe } from '@aurum/shared';
import { useEffect } from 'react';
import { useDeskStore } from '@/store/desk-store';

export const TF_KEYS: Record<string, Timeframe> = { '1': 'M1', '2': 'M5', '3': 'M15', '4': 'M30' };
export const PLAYBOOK_KEYS: Record<string, PlaybookId> = { a: 'intraday_m30_m15', b: 'scalp_m15_m5' };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/** 1/2/3/4 → timeframe, A/B → playbook, T → theme toggle, Esc → clear focus. Ignored while typing. */
export function useKeyboardShortcuts(onToggleTheme: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const { setTf, setPlaybook, focusSetup } = useDeskStore.getState();
      if (TF_KEYS[key]) setTf(TF_KEYS[key]!);
      else if (PLAYBOOK_KEYS[key]) setPlaybook(PLAYBOOK_KEYS[key]!);
      else if (key === 't') onToggleTheme();
      else if (key === 'escape') focusSetup(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleTheme]);
}
