import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { useAuthStore } from '@/stores/authStore';
import { reportsApi } from '@/services/api/reportsApi';
import { PlatformReportPrintView } from '@/features/analytics/components/PlatformReportRenderer';
import type { PlatformRunReportPayload } from '@/types/platformReports';

/**
 * Inject the print token into the auth store at module load — before any
 * component mounts or apiRequest reads `accessToken`. This way the very first
 * fetch (`fetchReportRunArtifact`) carries the right Bearer.
 */
function bootstrapTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    useAuthStore.getState().setAccessToken(token);
  }
}

bootstrapTokenFromUrl();

/**
 * Print-mode renderer for evaluation report runs. Backend Playwright navigates
 * here with a one-shot ?token=<jwt> in the URL, the page injects the token,
 * fetches the report artifact, renders the SAME components the live UI uses,
 * and signals readiness via `body[data-report-ready="true"]` so the headless
 * browser can snapshot to PDF.
 *
 * The whole point of this surface is parity: there is exactly one renderer
 * (PlatformReportPrintView), so the PDF can never drift from the UI.
 */
export function PrintReportRun() {
  const { reportRunId } = useParams<{ reportRunId: string }>();
  const [searchParams] = useSearchParams();
  const [report, setReport] = useState<PlatformRunReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportRunId) {
      setError('Missing reportRunId in URL');
      return;
    }
    const tokenFromUrl = searchParams.get('token');
    if (tokenFromUrl) {
      useAuthStore.getState().setAccessToken(tokenFromUrl);
    }
    let cancelled = false;
    reportsApi
      .fetchReportRunArtifact(reportRunId)
      .then((payload) => {
        if (!cancelled) setReport(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch report');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reportRunId, searchParams]);

  // Mark the body data-report-ready ONLY after the report has rendered AND
  // layout has had a chance to settle. Two RAFs is sufficient for synchronous
  // chart bars, table rows, and the section header gradient — none of which
  // depend on async chart libs.
  useEffect(() => {
    if (!report) return;
    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document.body.setAttribute('data-report-ready', 'true');
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
      document.body.removeAttribute('data-report-ready');
    };
  }, [report]);

  // Surface fetch errors to the headless browser so the PDF endpoint fails
  // fast instead of timing out on the readiness selector.
  useEffect(() => {
    if (!error) return;
    document.body.setAttribute('data-report-error', error);
    document.body.setAttribute('data-report-ready', 'true');
  }, [error]);

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] p-6">
        <div className="mx-auto max-w-[920px] rounded-md border border-[var(--color-error)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--color-error)]">
          Failed to load report: {error}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] p-6">
        <div className="mx-auto max-w-[920px] text-sm text-[var(--text-muted)]">Loading report…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-[920px] px-6 py-6">
        <PlatformReportPrintView report={report} />
      </div>
    </div>
  );
}

export default PrintReportRun;
