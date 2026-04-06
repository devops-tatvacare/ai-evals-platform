import { apiRequest, apiDownload } from './client';
import type { CrossRunAnalyticsResponse } from '@/types/crossRunAnalytics';
import type { PlatformCrossRunNarrative, PlatformCrossRunPayload, PlatformRunReportPayload } from '@/types/platformReports';
import type { ReportConfigSummary, ReportRunSummary } from '@/types';

export const reportsApi = {
  listReportConfigs: (appId: string, scope: string): Promise<ReportConfigSummary[]> => {
    const params = new URLSearchParams({ app_id: appId, scope });
    return apiRequest<ReportConfigSummary[]>(`/api/reports/report-configs?${params.toString()}`);
  },

  listReportRuns: (params: {
    appId: string;
    scope: string;
    sourceEvalRunId?: string;
    reportId?: string;
    limit?: number;
  }): Promise<ReportRunSummary[]> => {
    const query = new URLSearchParams({ app_id: params.appId, scope: params.scope });
    if (params.sourceEvalRunId) query.set('source_eval_run_id', params.sourceEvalRunId);
    if (params.reportId) query.set('report_id', params.reportId);
    if (params.limit) query.set('limit', String(params.limit));
    return apiRequest<ReportRunSummary[]>(`/api/reports/report-runs?${query.toString()}`);
  },

  fetchReportRunArtifact: (reportRunId: string): Promise<PlatformRunReportPayload> =>
    apiRequest<PlatformRunReportPayload>(`/api/reports/report-runs/${reportRunId}/artifact`),

  /**
   * Fetch the full report for a completed eval run.
   * Cached after first generation; pass refresh=true to force regeneration.
   * Optionally specify provider/model for AI narrative generation.
   */
  fetchReport: <TReport = PlatformRunReportPayload>(runId: string, opts?: { refresh?: boolean; cacheOnly?: boolean; provider?: string; model?: string }): Promise<TReport> => {
    const params = new URLSearchParams();
    if (opts?.refresh) params.set('refresh', 'true');
    if (opts?.cacheOnly) params.set('cache_only', 'true');
    if (opts?.provider) params.set('provider', opts.provider);
    if (opts?.model) params.set('model', opts.model);
    const qs = params.toString();
    return apiRequest<TReport>(
      `/api/reports/${runId}${qs ? `?${qs}` : ''}`,
    );
  },

  /** Export report as PDF via server-side headless browser rendering. */
  exportPdf: (runId: string): Promise<Blob> =>
    apiDownload(`/api/reports/${runId}/export-pdf`),

  exportReportRunPdf: (reportRunId: string): Promise<Blob> =>
    apiDownload(`/api/reports/report-runs/${reportRunId}/export-pdf`),

  /** Fetch cached cross-run analytics for an app. */
  fetchCrossRunAnalytics: <TAnalytics = PlatformCrossRunPayload>(appId: string): Promise<CrossRunAnalyticsResponse<TAnalytics>> => {
    const params = new URLSearchParams({ app_id: appId });
    return apiRequest<CrossRunAnalyticsResponse<TAnalytics>>(`/api/reports/cross-run-analytics?${params}`);
  },

  /** Recompute cross-run analytics from single_run caches and persist. */
  refreshCrossRunAnalytics: <TAnalytics = PlatformCrossRunPayload>(appId: string, limit?: number): Promise<CrossRunAnalyticsResponse<TAnalytics>> => {
    const params = new URLSearchParams({ app_id: appId });
    if (limit) params.set('limit', String(limit));
    return apiRequest<CrossRunAnalyticsResponse<TAnalytics>>(`/api/reports/cross-run-analytics/refresh?${params}`, {
      method: 'POST',
    });
  },

  /** Generate AI summary of cross-run analytics. */
  generateCrossRunSummary: (payload: { appId: string; provider?: string; model?: string }): Promise<PlatformCrossRunNarrative> =>
    apiRequest<PlatformCrossRunNarrative>('/api/reports/cross-run-ai-summary', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
