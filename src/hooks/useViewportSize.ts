import { useEffect, useState } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
}

function readViewport(): ViewportSize {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Subscribes the caller to window resize events so any value derived from
 * `window.innerWidth/innerHeight` during render stays in sync.
 *
 * Use this whenever a component's render reads viewport size directly —
 * without a resize listener, the component will hold a stale value after
 * the user resizes the browser.
 */
export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(readViewport);

  useEffect(() => {
    const handler = () => setSize(readViewport());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return size;
}
