import { useState, useEffect, useCallback, useRef } from 'react';

export interface Section {
  id: string;
  title: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Scans <h2> elements inside `containerSelector`, tracks active section
 * via IntersectionObserver rooted on `scrollSelector`, and provides
 * smooth-scroll navigation.
 */
export function useSectionRail(
  /** Re-scan trigger (e.g. active tab id) */
  pageKey: string,
  /** CSS selector for the element containing <h2>s */
  containerSelector: string,
  /** CSS selector for the scrollable ancestor (IntersectionObserver root) */
  scrollSelector: string,
) {
  const [sections, setSections] = useState<Section[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    let cancelled = false;

    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;

      const container = document.querySelector(containerSelector);
      if (!container) return;

      const headings = Array.from(container.querySelectorAll('h2'));
      if (headings.length < 2) {
        setSections([]);
        setActiveId('');
        return;
      }

      // Assign IDs with collision dedup
      const usedIds = new Set<string>();
      const sectionList: Section[] = headings.map((h2) => {
        const text = h2.textContent?.trim() ?? '';
        let base = slugify(text);
        if (!base) base = 'section';

        let id = base;
        let counter = 2;
        while (usedIds.has(id)) {
          id = `${base}-${counter}`;
          counter++;
        }
        usedIds.add(id);
        h2.id = id;
        return { id, title: text };
      });

      setSections(sectionList);
      setActiveId(sectionList[0]?.id ?? '');

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      const scrollRoot = document.querySelector(scrollSelector) as Element | null;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          const intersecting = entries.filter((e) => e.isIntersecting);
          if (intersecting.length > 0) {
            const top = intersecting.reduce((a, b) =>
              a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
            );
            setActiveId(top.target.id);
          }
        },
        {
          root: scrollRoot,
          rootMargin: '-80px 0px -60% 0px',
        },
      );

      headings.forEach((h2) => observerRef.current!.observe(h2));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [pageKey, containerSelector, scrollSelector]);

  const scrollTo = useCallback(
    (id: string) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [],
  );

  return { sections, activeId, scrollTo };
}
