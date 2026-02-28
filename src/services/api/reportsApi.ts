import { apiRequest, apiDownload } from './client';
import type { ReportPayload } from '@/types/reports';

export const reportsApi = {
  /**
   * Fetch the full report for a completed eval run.
   * Cached after first generation; pass refresh=true to force regeneration.
   * Optionally specify provider/model for AI narrative generation.
   */
  fetchReport: (runId: string, opts?: { refresh?: boolean; cacheOnly?: boolean; provider?: string; model?: string }): Promise<ReportPayload> => {
    const params = new URLSearchParams();
    if (opts?.refresh) params.set('refresh', 'true');
    if (opts?.cacheOnly) params.set('cache_only', 'true');
    if (opts?.provider) params.set('provider', opts.provider);
    if (opts?.model) params.set('model', opts.model);
    const qs = params.toString();
    return apiRequest<ReportPayload>(
      `/api/reports/${runId}${qs ? `?${qs}` : ''}`,
    );
  },

  /** Export report as PDF via server-side headless browser rendering. */
  exportPdf: (runId: string): Promise<Blob> =>
    apiDownload(`/api/reports/${runId}/export-pdf`),
};
