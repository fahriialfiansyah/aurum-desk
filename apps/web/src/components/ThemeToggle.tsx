'use client';

import { useTheme } from '@/lib/theme';

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      className="h-6 border border-line px-2 text-[10px] uppercase tracking-wider text-muted hover:border-line-strong hover:text-fg"
      title="Ganti tema (T)"
      aria-label="Ganti tema"
    >
      {theme === 'dark' ? '☾ dark' : '☀ light'}
    </button>
  );
}
