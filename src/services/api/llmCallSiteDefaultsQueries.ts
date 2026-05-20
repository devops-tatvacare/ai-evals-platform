import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiQueryFn } from '@/services/api/queryFn';
import {
  callSiteDefaultsApi,
  type CallSiteDefault,
  type CallSiteDefaultUpsert,
  type CallSiteSpec,
} from '@/services/api/llmCallSiteDefaultsApi';

const TENANT_KEY = ['admin', 'llm', 'defaults', 'tenant'] as const;
const PLATFORM_KEY = ['admin', 'llm', 'defaults', 'platform'] as const;
const REGISTRY_KEY = ['llm', 'call-sites'] as const;

export function useCallSiteRegistry() {
  return useQuery<CallSiteSpec[]>({
    queryKey: REGISTRY_KEY,
    queryFn: () => apiQueryFn<CallSiteSpec[]>('/api/llm/call-sites'),
    staleTime: 5 * 60_000,
  });
}

export function useTenantCallSiteDefaults() {
  return useQuery<CallSiteDefault[]>({
    queryKey: TENANT_KEY,
    queryFn: () => apiQueryFn<CallSiteDefault[]>('/api/admin/llm/defaults'),
    staleTime: 30_000,
  });
}

export function useUpsertTenantDefault() {
  const qc = useQueryClient();
  return useMutation<
    CallSiteDefault,
    Error,
    { callSite: string; body: CallSiteDefaultUpsert }
  >({
    mutationFn: ({ callSite, body }) =>
      callSiteDefaultsApi.upsertTenant(callSite, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANT_KEY }),
  });
}

export function useDeleteTenantDefault() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (callSite) => callSiteDefaultsApi.deleteTenant(callSite),
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANT_KEY }),
  });
}

export function usePlatformCallSiteDefaults(enabled: boolean) {
  return useQuery<CallSiteDefault[]>({
    queryKey: PLATFORM_KEY,
    queryFn: () => apiQueryFn<CallSiteDefault[]>('/api/platform/llm/defaults'),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpsertPlatformDefault() {
  const qc = useQueryClient();
  return useMutation<
    CallSiteDefault,
    Error,
    { callSite: string; body: CallSiteDefaultUpsert }
  >({
    mutationFn: ({ callSite, body }) =>
      callSiteDefaultsApi.upsertPlatform(callSite, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PLATFORM_KEY });
      // Tenant rows fall through to platform when missing, so tenant view
      // refresh too.
      qc.invalidateQueries({ queryKey: TENANT_KEY });
    },
  });
}
