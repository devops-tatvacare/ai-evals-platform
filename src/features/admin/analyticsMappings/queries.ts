/**
 * TQ hooks for the analytics mirror->fact mapping admin surface.
 *
 * Phase 3 of docs/plans/2026-05-12-analytics-facts-canonical-manifest-thinning.md.
 * Reads/mutations go through `apiQueryFn` so the centralised
 * 401-refresh-and-retry flow stays in effect (CLAUDE.md, "TanStack Query"
 * reuse rule).
 *
 * Key shape: `['analyticsAdmin', 'mappings']`. List queries invalidate on
 * any mutation so the admin table reflects the new state without a hand-
 * rolled refetch dance.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  disableMapping,
  enableMapping,
  listMappings,
  type DisableMappingRequest,
  type MappingStateListResponse,
  type MappingStateRow,
} from '@/services/api/analyticsAdmin';

const MAPPINGS_KEY = ['analyticsAdmin', 'mappings'] as const;

export function useMappingState() {
  return useQuery<MappingStateListResponse>({
    queryKey: MAPPINGS_KEY,
    queryFn: listMappings,
  });
}

export function useDisableMapping() {
  const queryClient = useQueryClient();
  return useMutation<
    MappingStateRow,
    Error,
    { mappingId: string; body: DisableMappingRequest }
  >({
    mutationFn: ({ mappingId, body }) => disableMapping(mappingId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAPPINGS_KEY });
    },
  });
}

export function useEnableMapping() {
  const queryClient = useQueryClient();
  return useMutation<MappingStateRow, Error, { mappingId: string }>({
    mutationFn: ({ mappingId }) => enableMapping(mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAPPINGS_KEY });
    },
  });
}
