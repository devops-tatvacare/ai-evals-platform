import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortOrder, SortState } from '@/components/ui/DataTable';

export interface TableQueryState {
  page: number;
  pageSize: number;
  sort?: string;
  order?: SortOrder;
  filters: Record<string, string | string[]>;
}

interface UseTableQueryParamsOptions {
  /** Default page size. Default 25. */
  defaultPageSize?: number;
  /** URL keys that represent filter values. Used to extract them and compute activeFilterCount. */
  filterKeys: string[];
  /** Subset of filterKeys whose values are debounced before the URL updates. */
  textFilterKeys?: string[];
  /** Debounce delay for text filters in ms. Default 300. */
  debounceTextMs?: number;
  /** Default sort, applied if no URL sort is present. */
  defaultSort?: SortState;
  /** Treat these keys as comma-separated multi-value filters. */
  multiValueKeys?: string[];
}

interface UseTableQueryParamsResult {
  state: TableQueryState;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (next: SortState) => void;
  setFilters: (patch: Record<string, unknown>) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

function readFilterValue(
  params: URLSearchParams,
  key: string,
  multi: boolean,
): string | string[] {
  if (multi) {
    const raw = params.get(key);
    if (!raw) return [];
    return raw.split(',').filter(Boolean);
  }
  return params.get(key) ?? '';
}

function serializeFilterValue(value: unknown, multi: boolean): string | null {
  if (multi) {
    if (!Array.isArray(value) || value.length === 0) return null;
    return (value as string[]).filter(Boolean).join(',');
  }
  if (value == null) return null;
  const str = String(value);
  return str.length > 0 ? str : null;
}

function isActiveFilter(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value == null) return false;
  return String(value).length > 0;
}

export function useTableQueryParams({
  defaultPageSize = 25,
  filterKeys,
  textFilterKeys = [],
  debounceTextMs = 300,
  defaultSort,
  multiValueKeys = [],
}: UseTableQueryParamsOptions): UseTableQueryParamsResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const multiSet = useMemo(() => new Set(multiValueKeys), [multiValueKeys]);
  const textSet = useMemo(() => new Set(textFilterKeys), [textFilterKeys]);

  const urlFilters = useMemo(() => {
    const out: Record<string, string | string[]> = {};
    for (const key of filterKeys) {
      out[key] = readFilterValue(searchParams, key, multiSet.has(key));
    }
    return out;
    // Intentionally depend on searchParams.toString() to get a stable dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, filterKeys.join('|'), multiValueKeys.join('|')]);

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const pageSize = Number(searchParams.get('pageSize')) || defaultPageSize;
  const sort = searchParams.get('sort') ?? defaultSort?.key;
  const order = (searchParams.get('order') as SortOrder | null) ?? defaultSort?.order;

  // Pending text-filter values (not yet flushed to URL).
  const [pendingText, setPendingText] = useState<Record<string, string>>({});

  // Debounce flush pending text changes to URL.
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const keys = Object.keys(pendingText);
    if (keys.length === 0) return;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const k of keys) {
            const v = pendingText[k];
            if (v && v.length > 0) next.set(k, v);
            else next.delete(k);
          }
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
      setPendingText({});
    }, debounceTextMs);
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [pendingText, debounceTextMs, setSearchParams]);

  const state: TableQueryState = useMemo(() => {
    const merged: Record<string, string | string[]> = { ...urlFilters };
    for (const [k, v] of Object.entries(pendingText)) {
      merged[k] = v;
    }
    return {
      page,
      pageSize,
      sort: sort ?? undefined,
      order: order ?? undefined,
      filters: merged,
    };
  }, [urlFilters, pendingText, page, pageSize, sort, order]);

  const setPage = useCallback(
    (p: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('page', String(p));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setPageSize = useCallback(
    (size: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('pageSize', String(size));
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSort = useCallback(
    (nextSort: SortState) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('sort', nextSort.key);
          next.set('order', nextSort.order);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFilters = useCallback(
    (patch: Record<string, unknown>) => {
      const textPatch: Record<string, string> = {};
      const urlPatch: Record<string, string | null> = {};

      for (const [key, value] of Object.entries(patch)) {
        if (textSet.has(key)) {
          textPatch[key] = value == null ? '' : String(value);
        } else {
          urlPatch[key] = serializeFilterValue(value, multiSet.has(key));
        }
      }

      if (Object.keys(textPatch).length > 0) {
        setPendingText((prev) => ({ ...prev, ...textPatch }));
      }

      if (Object.keys(urlPatch).length > 0) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            for (const [k, v] of Object.entries(urlPatch)) {
              if (v == null) next.delete(k);
              else next.set(k, v);
            }
            next.set('page', '1');
            return next;
          },
          { replace: true },
        );
      }
    },
    [setSearchParams, multiSet, textSet],
  );

  const clearFilters = useCallback(() => {
    setPendingText({});
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of filterKeys) next.delete(key);
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams, filterKeys]);

  const activeFilterCount = useMemo(
    () => filterKeys.filter((k) => isActiveFilter(state.filters[k])).length,
    [filterKeys, state.filters],
  );

  return { state, setPage, setPageSize, setSort, setFilters, clearFilters, activeFilterCount };
}
