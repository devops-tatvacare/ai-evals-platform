import { useState, useEffect } from 'react';
import { resolveColor } from '@/utils/statusColors';

/**
 * Hook that resolves a CSS variable to its computed hex value,
 * re-resolving when the theme changes via data-theme attribute.
 *
 * Use this for Recharts/canvas attributes that need resolved hex values.
 */
export function useResolvedColor(cssVar: string): string {
  const [color, setColor] = useState(() => resolveColor(cssVar));

  useEffect(() => {
    // Re-resolve immediately in case theme changed before mount
    setColor(resolveColor(cssVar));

    const observer = new MutationObserver(() => {
      setColor(resolveColor(cssVar));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [cssVar]);

  return color;
}
