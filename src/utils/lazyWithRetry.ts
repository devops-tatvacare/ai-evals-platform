import { lazy, type ComponentType } from 'react';

const RELOADED_KEY = 'lazyWithRetry:reloaded';

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  );
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOADED_KEY);
      return mod;
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      if (sessionStorage.getItem(RELOADED_KEY) === '1') throw err;
      sessionStorage.setItem(RELOADED_KEY, '1');
      window.location.reload();
      return new Promise<{ default: T }>(() => {});
    }
  });
}
