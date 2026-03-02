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

export function useSectionRail(pageKey: string) {
  const [sections, setSections] = useState<Section[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Scan h2s and set up observer on page change
  useEffect(() => {
    let cancelled = false;

    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;

      const container = document.querySelector('.page-content');
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

      // Clean up previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      // Set up IntersectionObserver
      observerRef.current = new IntersectionObserver(
        (entries) => {
          // Find the topmost intersecting entry
          const intersecting = entries.filter((e) => e.isIntersecting);
          if (intersecting.length > 0) {
            // Pick the one closest to top of viewport
            const top = intersecting.reduce((a, b) =>
              a.boundingClientRect.top < b.boundingClientRect.top ? a : b
            );
            setActiveId(top.target.id);
          }
        },
        {
          rootMargin: '-24px 0px -60% 0px',
        }
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
  }, [pageKey]);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return { sections, activeId, scrollTo };
}
