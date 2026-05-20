import { useQuery, useQueryClient } from '@tanstack/react-query';

import { reportsApi } from '@/services/api/reportsApi';
import type { ReportConfigSummary, ReportRunSummary } from '@/types';
import type { PlatformRunReportPayload } from '@/types/platformReports';

/**
 * Phase 2 — reporting read-path TQ hooks.
 *
 * Pre-Phase-2 `ReportTab.tsx` carried three useState + useEffect fetch loops
 * for configs / reportRuns / report. Mount/unmount cycles refetched even when
 * the same data was still warm; switching reportId in the dropdown produced a
 * waterfall the user could trigger faster than the network could resolve.
 * TQ's keyed cache + reactive-key refetch handles both.
 *
 * Mutations (export, generate-report job submission) stay imperative — the
 * generate flow's heavy lifting is in `submitAndPollJob`'s polling, which TQ
 * doesn't model. The one useful side-effect — invalidating the runs list on
 * successful generation — is a single `queryClient.invalidateQueries` call.
 *
 * Key shape (local factory, matches Phase 14's inline-keys pattern at
 * `src/features/orchestration/queries/referenceData.ts:32-37`; a central
 * queryKeys.ts arrives later in Phase 15 Wave 0):
 *   ['reports', 'configs', appId, scope]
 *   ['reports', 'runs', appId, scope, sourceEvalRunId|'all', reportId|'all', limit]
 *   ['reports', 'artifact', reportRunId]
 */

export const reportKeys = {
  configs: (appId: string, scope: string) =>
    ['reports', 'configs', appId, scope] as const,
  runs: (filters: {
    appId: string;
    scope: string;
    sourceEvalRunId?: string;
    reportId?: string;
    limit?: number;
  }) =>
    [
      'reports',
      'runs',
      filters.appId,
      filters.scope,
      filters.sourceEvalRunId ?? 'all',
      filters.reportId ?? 'all',
      filters.limit ?? 0,
    ] as const,
  artifact: (reportRunId: string) =>
    ['reports', 'artifact', reportRunId] as const,
};

const CONFIGS_STALE_MS = 60_000;
const RUNS_STALE_MS = 30_000;

/**
 * Report configurations rarely change — 60 s stale-time is enough to keep
 * dropdown reopens out of the network. Manage-blueprints mutations invalidate
 * this key explicitly so a save → close → reopen reflects immediately.
 */
export function useReportConfigs(
  appId: string,
  scope: 'single_run' | 'cross_run',
) {
  return useQuery<ReportConfigSummary[]>({
    queryKey: reportKeys.configs(appId, scope),
    queryFn: () => reportsApi.listReportConfigs(appId, scope),
    staleTime: CONFIGS_STALE_MS,
  });
}

/**
 * Report runs change when a generate-report job completes. The mutation handler
 * invalidates this key on terminal success so the runs list refreshes without
 * a manual reload. `refetchOnWindowFocus: true` covers the multi-tab case where
 * a job completes in another tab.
 */
export function useReportRuns(filters: {
  appId: string;
  scope: 'single_run' | 'cross_run';
  sourceEvalRunId?: string;
  reportId?: string | null;
  limit?: number;
}) {
  const enabled = Boolean(filters.reportId);
  return useQuery<ReportRunSummary[]>({
    queryKey: reportKeys.runs({
      appId: filters.appId,
      scope: filters.scope,
      sourceEvalRunId: filters.sourceEvalRunId,
      reportId: filters.reportId ?? undefined,
      limit: filters.limit,
    }),
    queryFn: () =>
      reportsApi.listReportRuns({
        appId: filters.appId,
        scope: filters.scope,
        sourceEvalRunId: filters.sourceEvalRunId,
        reportId: filters.reportId as string,
        limit: filters.limit,
      }),
    enabled,
    staleTime: RUNS_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Report artifacts are immutable once generated — `staleTime: Infinity` keeps
 * the cache warm for the whole session.
 */
export function useReportRunArtifact(reportRunId: string | null) {
  const enabled = Boolean(reportRunId);
  return useQuery<PlatformRunReportPayload>({
    queryKey: enabled
      ? reportKeys.artifact(reportRunId as string)
      : ['reports', 'artifact', '__disabled__'],
    queryFn: () => reportsApi.fetchReportRunArtifact(reportRunId as string),
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Imperative cache-busting helpers for the mutation paths in `ReportTab.tsx`
 * and the manage-blueprints slide-over. Imported only by callers that already
 * have a `useQueryClient()` reference (these are not hooks themselves).
 */
export function invalidateReportConfigs(
  queryClient: ReturnType<typeof useQueryClient>,
  appId: string,
  scope: 'single_run' | 'cross_run',
) {
  return queryClient.invalidateQueries({
    queryKey: reportKeys.configs(appId, scope),
  });
}

export function invalidateReportRuns(
  queryClient: ReturnType<typeof useQueryClient>,
  filters: {
    appId: string;
    scope: 'single_run' | 'cross_run';
    sourceEvalRunId?: string;
    reportId?: string;
  },
) {
  return queryClient.invalidateQueries({
    // Partial-key invalidation: any runs query matching the prefix refreshes.
    queryKey: ['reports', 'runs', filters.appId, filters.scope],
  });
}
