import { useCallback, useEffect, useState } from 'react';

export function useMeasuredWidth<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  const ref = useCallback((next: T | null) => {
    setNode(next);
    if (!next) {
      setWidth(undefined);
      return;
    }
    const nextWidth = next.getBoundingClientRect().width;
    if (Number.isFinite(nextWidth) && nextWidth > 0) {
      setWidth(Math.round(nextWidth));
    }
  }, []);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const measure = (nextWidth: number) => {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
        return;
      }
      setWidth(Math.round(nextWidth));
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        measure(node.getBoundingClientRect().width);
        return;
      }
      measure(entry.contentRect.width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, width };
}
