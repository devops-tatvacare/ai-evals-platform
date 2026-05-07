import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listConnectionAgents,
  listConnectionTemplates,
  type ProviderAgentsListResponse,
  type ProviderTemplatesListResponse,
} from '@/services/api/orchestrationConnections';

/**
 * Phase 14 — orchestration reference-data hooks.
 *
 * The pre-Phase-14 pickers each carried their own `useState` + `useEffect`
 * fetch loop. Two pickers on the same connection produced two API calls; a
 * dialog reopen produced a fresh fetch even when the backend's 30 s
 * in-process cache still held the data. TQ's keyed cache replaces both.
 *
 * Key shape: `['orchestration', 'connection', connectionId, <resource>]`.
 * `staleTime: 30_000` matches the backend cache TTL exactly so dropdown
 * reopens within the window are served from cache without a network roundtrip.
 *
 * Refresh button: callers invoke `refetchWith({ refresh: true })` (the helper
 * wired below) to bypass both the FE cache and the backend cache. We use
 * `queryClient.fetchQuery` rather than `refetch()` so the `{refresh: true}`
 * argument flows through the queryFn — TQ's plain `refetch()` re-runs the
 * original queryFn signature with no way to thread a per-call flag.
 */

const STALE_TIME_MS = 30_000;

function watiTemplatesKey(connectionId: string) {
  return ['orchestration', 'connection', connectionId, 'wati-templates'] as const;
}

function bolnaAgentsKey(connectionId: string) {
  return ['orchestration', 'connection', connectionId, 'bolna-agents'] as const;
}

function watiTemplatesQueryOptions(
  connectionId: string,
  params?: { refresh?: boolean },
  staleTime = STALE_TIME_MS,
) {
  return {
    queryKey: watiTemplatesKey(connectionId),
    queryFn: params
      ? () => listConnectionTemplates(connectionId, params)
      : () => listConnectionTemplates(connectionId),
    staleTime,
  };
}

function bolnaAgentsQueryOptions(
  connectionId: string,
  params?: { refresh?: boolean },
  staleTime = STALE_TIME_MS,
) {
  return {
    queryKey: bolnaAgentsKey(connectionId),
    queryFn: params
      ? () => listConnectionAgents(connectionId, params)
      : () => listConnectionAgents(connectionId),
    staleTime,
  };
}

export function useWatiTemplates(connectionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(connectionId);

  const query = useQuery<ProviderTemplatesListResponse>({
    queryKey: enabled
      ? watiTemplatesKey(connectionId as string)
      : ['orchestration', 'connection', '__disabled__', 'wati-templates'],
    queryFn: watiTemplatesQueryOptions(connectionId as string).queryFn,
    enabled,
    staleTime: STALE_TIME_MS,
  });

  /** Force a network roundtrip past the backend's 30 s cache. Used by the
   *  picker's Refresh button — needed for the rare "I just approved a
   *  template in WATI" case. We bypass `query.refetch()` because that
   *  re-runs the original queryFn (which doesn't carry `refresh: true`).
   *  `fetchQuery` keeps the refresh on the same cache key, so both success
   *  and failure propagate through the observed query state. */
  const refresh = async () => {
    if (!connectionId) return query.data ?? null;
    try {
      return await queryClient.fetchQuery(
        watiTemplatesQueryOptions(connectionId, { refresh: true }, 0),
      );
    } catch {
      return queryClient.getQueryData<ProviderTemplatesListResponse>(
        watiTemplatesKey(connectionId),
      ) ?? null;
    }
  };

  return { ...query, refresh };
}

export function useBolnaAgents(connectionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(connectionId);

  const query = useQuery<ProviderAgentsListResponse>({
    queryKey: enabled
      ? bolnaAgentsKey(connectionId as string)
      : ['orchestration', 'connection', '__disabled__', 'bolna-agents'],
    queryFn: bolnaAgentsQueryOptions(connectionId as string).queryFn,
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const refresh = async () => {
    if (!connectionId) return query.data ?? null;
    try {
      return await queryClient.fetchQuery(
        bolnaAgentsQueryOptions(connectionId, { refresh: true }, 0),
      );
    } catch {
      return queryClient.getQueryData<ProviderAgentsListResponse>(
        bolnaAgentsKey(connectionId),
      ) ?? null;
    }
  };

  return { ...query, refresh };
}
