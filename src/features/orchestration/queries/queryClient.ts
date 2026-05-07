import { QueryClient } from '@tanstack/react-query';

/**
 * Phase 14 — orchestration QueryClient (also the platform foundation for
 * Phase 15's wave-by-wave migration).
 *
 * Defaults:
 * - `staleTime: 30_000` — matches the orchestration backend's in-process
 *   reference-data cache TTL. Reopening a picker within 30 s reuses cached
 *   data instead of refetching.
 * - `retry: 1` — one transparent retry on transient network failures, but
 *   structured 4xx errors fail fast so the UI surfaces them.
 * - `refetchOnWindowFocus: false` — preserves the prior `isLoaded`-skip
 *   behaviour of the homegrown stores. Wave-specific overrides (e.g.
 *   in-flight job lists) override this.
 * - `mutations.retry: 0` — never auto-retry a write.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
