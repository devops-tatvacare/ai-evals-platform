import { useQuery } from '@tanstack/react-query';

import { apiQueryFn } from '@/services/api/queryFn';
import {
  type CatalogModel,
  type LlmModelOption,
} from '@/services/api/llmModelsApi';

const MODELS_KEY = (callSite: string, credentialId: string | null) =>
  ['llm', 'models', callSite, credentialId] as const;

const CATALOG_KEY = (provider: string | undefined, includeDeprecated: boolean) =>
  ['llm', 'catalog', provider ?? 'all', includeDeprecated] as const;

export function useLlmModels(callSite: string, credentialId: string | null) {
  return useQuery<LlmModelOption[]>({
    queryKey: MODELS_KEY(callSite, credentialId),
    queryFn: () =>
      apiQueryFn<LlmModelOption[]>(
        `/api/llm/models?call_site=${encodeURIComponent(callSite)}&credential_id=${encodeURIComponent(credentialId ?? '')}`,
      ),
    enabled: !!credentialId && !!callSite,
    staleTime: 5 * 60_000,
  });
}

export function useLlmCatalog(
  params: { provider?: string; includeDeprecated?: boolean } = {},
) {
  const includeDeprecated = params.includeDeprecated ?? true;
  return useQuery<CatalogModel[]>({
    queryKey: CATALOG_KEY(params.provider, includeDeprecated),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (params.provider) qs.set('provider', params.provider);
      qs.set('include_deprecated', includeDeprecated ? 'true' : 'false');
      return apiQueryFn<CatalogModel[]>(`/api/llm/catalog?${qs.toString()}`);
    },
    staleTime: 10 * 60_000,
  });
}
