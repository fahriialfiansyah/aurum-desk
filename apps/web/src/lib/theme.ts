'use client';

import { create } from 'zustand';
import { THEME_STORAGE_KEY } from './config';

export type Theme = 'dark' | 'light';

function readInitial(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.dataset.theme;
  return attr === 'light' ? 'light' : 'dark';
}

type ThemeState = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void };

export const useTheme = create<ThemeState>()((set, get) => ({
  theme: readInitial(),
  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        /* storage may be unavailable (private mode); the attribute still applies */
      }
    }
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

export type ChartPalette = {
  bg: string;
  text: string;
  grid: string;
  crosshair: string;
  up: string;
  down: string;
  ink: string;
  inkFill: string;
  accent: string;
  muted: string;
  info: string;
  warn: string;
};

const DARK: ChartPalette = {
  bg: '#0b0d10', text: '#8b929c', grid: '#161a20', crosshair: '#4b5563', up: '#2fbf8f', down: '#e5534b',
  ink: '#ffffff', inkFill: 'rgba(255,255,255,0.12)', accent: '#f0b43c', muted: '#5b616b', info: '#6ea8fe', warn: '#f0b43c',
};
const LIGHT: ChartPalette = {
  bg: '#ffffff', text: '#5f6673', grid: '#ebedf0', crosshair: '#9aa0aa', up: '#1f9d6e', down: '#d1433c',
  ink: '#000000', inkFill: 'rgba(0,0,0,0.10)', accent: '#b7791f', muted: '#9aa0aa', info: '#2f6fd6', warn: '#b7791f',
};

/** Chart colors per theme. The entry/SL/TP lines and zone borders use `ink`: white on dark, black on light. */
export function chartPalette(theme: Theme): ChartPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
