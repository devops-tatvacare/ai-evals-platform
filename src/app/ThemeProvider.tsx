import { useEffect } from 'react';
import { useSettingsStore } from '@/stores';
import type { ThemeMode } from '@/types';

// localStorage key used by inline script in index.html for instant theme application
const THEME_STORAGE_KEY = 'ai-evals-theme';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

function applyTheme(theme: ThemeMode) {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

  // Add transitioning attribute for smooth CSS transitions
  document.documentElement.setAttribute('data-theme-transitioning', '');
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => {
    document.documentElement.removeAttribute('data-theme-transitioning');
    transitionTimer = null;
  }, 300);

  document.documentElement.setAttribute('data-theme', resolvedTheme);
  // Sync to localStorage so inline script in index.html can read it on next load
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore localStorage errors (e.g., private browsing)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('system');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  return <>{children}</>;
}
