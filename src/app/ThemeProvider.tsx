import { useEffect } from 'react';
import { useGlobalSettingsStore } from '@/stores/globalSettingsStore';
import type { ThemeMode } from '@/types';

// localStorage key used by inline script in index.html for instant theme application
const THEME_STORAGE_KEY = 'ai-evals-theme';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

function applyTheme(theme: ThemeMode) {
  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
  const currentTheme = document.documentElement.getAttribute('data-theme');

  // Skip if the DOM already has the correct theme (avoids unnecessary transition on load)
  if (currentTheme === resolvedTheme) {
    // Still sync localStorage even if DOM is already correct
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage errors
    }
    return;
  }

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
  const theme = useGlobalSettingsStore((state) => state.theme);

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
