import { useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';
export type EffectiveMode = 'dark' | 'light';

const STORAGE_KEY = 'xsterm-theme-mode';

function getSystemPreference(): EffectiveMode {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === 'dark' || v === 'light' || v === 'system') return v;
  return 'system';
}

export function useAppTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [systemMode, setSystemMode] = useState<EffectiveMode>(getSystemPreference);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemMode(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, newMode);
    setModeState(newMode);
  }, []);

  const effectiveMode: EffectiveMode = mode === 'system' ? systemMode : mode;

  return { mode, setMode, effectiveMode };
}