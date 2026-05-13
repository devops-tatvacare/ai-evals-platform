import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCollectionSuggestions,
  type InsideSalesCollectionFamily,
  type SuggestionField,
} from '@/services/api/insideSales';

interface UseCollectionSuggestionsResult {
  options: string[];
  loading: boolean;
  onSearchChange: (query: string) => void;
  error: string | null;
}

/**
 * Debounced type-ahead hook for Inside Sales filter inputs.
 *
 * Fires `GET /api/inside-sales/collections/{family}/suggestions` with the
 * user's current query after a short debounce. Stale responses are ignored
 * via a request-id counter so a slow reply cannot overwrite a fresh one.
 *
 * Kept here rather than in a shared `hooks/` folder because the suggestion
 * endpoint is Inside-Sales-specific; generalize when a second consumer
 * appears.
 */
export function useCollectionSuggestions(
  sourceFamily: InsideSalesCollectionFamily,
  field: SuggestionField,
  options: { debounceMs?: number; minLength?: number; limit?: number } = {},
): UseCollectionSuggestionsResult {
  const { debounceMs = 250, minLength = 0, limit = 20 } = options;

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (query.length < minLength && query.trim().length === 0) {
      // Show a baseline list on initial open: distinct values with no filter.
      // Skipping this for minLength > 0 so consumers can demand a keystroke
      // before hitting the network.
      if (minLength > 0) {
        setItems([]);
        return;
      }
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const values = await fetchCollectionSuggestions(
          sourceFamily,
          field,
          query,
          limit,
        );
        if (requestId !== requestIdRef.current) return; // stale
        setItems(values);
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        setError(e instanceof Error ? e.message : 'Failed to load suggestions');
        setItems([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [sourceFamily, field, query, debounceMs, minLength, limit]);

  const onSearchChange = useCallback((next: string) => {
    setQuery(next);
  }, []);

  return { options: items, loading, onSearchChange, error };
}
