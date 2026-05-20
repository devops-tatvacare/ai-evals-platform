/**
 * TanStack hook for the legacy provider-summary list.
 *
 * Per-credential CRUD hooks live in `llmCredentialsQueries.ts`; this file
 * only carries the GET hook still consumed by 8 pages for `credentialsOk`
 * gating ("does this tenant have any working credential for provider X?").
 *
 * Located in `services/api/` (not `features/admin/`) so shared
 * `components/ui` surfaces can import without a `ui → features` layering
 * violation.
 */
import { useQuery } from '@tanstack/react-query';

import {
  aiSettingsApi,
  type ProviderConfig,
} from '@/services/api/aiSettingsApi';

export const AI_SETTINGS_QUERY_KEY = ['admin', 'ai-settings', 'providers'] as const;

export function useProviderConfigs() {
  return useQuery<ProviderConfig[]>({
    queryKey: AI_SETTINGS_QUERY_KEY,
    queryFn: () => aiSettingsApi.list(),
    staleTime: 30_000,
  });
}
