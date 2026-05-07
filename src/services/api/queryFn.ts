import { apiRequest } from './client';

/**
 * Shared TanStack Query fetcher. Feature-level query hooks call this instead
 * of raw `fetch` so they inherit auth headers and the 401-refresh-retry flow.
 */
export function apiQueryFn<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, init);
}
