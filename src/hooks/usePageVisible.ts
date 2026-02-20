import { useState, useEffect } from 'react';

/**
 * Returns true when the browser tab/page is visible, false when hidden.
 *
 * Used by polling loops to pause network requests when the user
 * has switched away from the tab.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(!document.hidden);

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible;
}
