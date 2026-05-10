/**
 * TanStack Query hooks for the Sherlock admin surface.
 * apiQueryFn keeps every read on the shared 401-refresh-retry flow.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiQueryFn } from '@/services/api/queryFn';
import {
  createVerifiedQuery,
  deleteVerifiedQuery,
  putInstructions,
  updateVerifiedQuery,
  type SherlockInstructionsResponse,
  type VerifiedQueryCreateInput,
  type VerifiedQueryListResponse,
  type VerifiedQueryRow,
  type VerifiedQueryUpdateInput,
} from '@/services/api/sherlockAdmin';

export const sherlockAdminKeys = {
  list: (filters: { appId?: string; includeSystem: boolean; onlyEnabled: boolean }) =>
    ['sherlock', 'verified-queries', filters] as const,
  instructions: () => ['sherlock', 'instructions'] as const,
};

export function useVerifiedQueries(filters: {
  appId?: string;
  includeSystem?: boolean;
  onlyEnabled?: boolean;
}) {
  const includeSystem = filters.includeSystem !== false;
  const onlyEnabled = filters.onlyEnabled === true;
  return useQuery({
    queryKey: sherlockAdminKeys.list({
      appId: filters.appId,
      includeSystem,
      onlyEnabled,
    }),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.appId) qs.set('appId', filters.appId);
      if (!includeSystem) qs.set('includeSystem', 'false');
      if (onlyEnabled) qs.set('onlyEnabled', 'true');
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return apiQueryFn<VerifiedQueryListResponse>(
        `/api/sherlock/verified-queries${suffix}`,
      );
    },
  });
}

export function useCreateVerifiedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VerifiedQueryCreateInput): Promise<VerifiedQueryRow> =>
      createVerifiedQuery(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sherlock', 'verified-queries'] });
    },
  });
}

export function useUpdateVerifiedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: VerifiedQueryUpdateInput }) =>
      updateVerifiedQuery(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sherlock', 'verified-queries'] });
    },
  });
}

export function useDeleteVerifiedQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteVerifiedQuery(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sherlock', 'verified-queries'] });
    },
  });
}

export function useInstructions() {
  return useQuery({
    queryKey: sherlockAdminKeys.instructions(),
    queryFn: () =>
      apiQueryFn<SherlockInstructionsResponse>(
        '/api/sherlock/verified-queries/instructions',
      ),
  });
}

export function usePutInstructions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantOverride: string | null) => putInstructions(tenantOverride),
    onSuccess: (data) => {
      qc.setQueryData(sherlockAdminKeys.instructions(), data);
    },
  });
}
