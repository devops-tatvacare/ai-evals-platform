import { apiRequest, apiDownload } from './client';
import type { PlatformRunReportPayload } from '@/types/platformReports';
import type { ReportConfigSummary, ReportRunSummary } from '@/types';

export interface BlueprintSaveSection {
  id: string;
  type: string;
  title: string;
  variant?: string;
}

export interface BlueprintSavePayload {
  appId: string;
  name: string;
  sections: BlueprintSaveSection[];
  sourceSessionId?: string;
}

export const reportsApi = {
  listReportConfigs: (appId: string, scope: string): Promise<ReportConfigSummary[]> => {
    const params = new URLSearchParams({ app_id: appId, scope });
    return apiRequest<ReportConfigSummary[]>(`/api/reports/report-configs?${params.toString()}`);
  },

  saveBlueprint: (payload: BlueprintSavePayload): Promise<ReportConfigSummary> =>
    apiRequest<ReportConfigSummary>('/api/reports/report-configs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateBlueprint: (
    configId: string,
    patch: { name?: string; description?: string; isDefault?: boolean },
  ): Promise<ReportConfigSummary> =>
    apiRequest<ReportConfigSummary>(`/api/reports/report-configs/${configId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  archiveBlueprint: (configId: string): Promise<void> =>
    apiRequest<void>(`/api/reports/report-configs/${configId}`, {
      method: 'DELETE',
    }),

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
};
