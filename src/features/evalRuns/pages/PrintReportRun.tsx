import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useAuthStore } from '@/stores/authStore';
import { reportsApi } from '@/services/api/reportsApi';
import { PlatformReportView } from '@/features/analytics/components/PlatformReportRenderer';
import type { PlatformRunReportPayload } from '@/types/platformReports';
import '@/styles/print-mode.css';

declare global {
  interface Window {
    __REPORT_PRINT_TOKEN__?: string;
  }
}

const PRINT_BODY_CLASS = 'report-print-mode';
/** Stop watching for layout settle once the page hasn't grown for this long. */
const HEIGHT_STABLE_WINDOW_MS = 150;
/** Hard cap so a misbehaving section can never wedge the headless renderer. */
const READINESS_TIMEOUT_MS = 8_000;

/**
 * Bridge the headless-Chromium auth token into the SPA before any component
 * mounts or `apiRequest` reads `accessToken`. Backend injects via
 * `add_init_script`; the URL-query fallback is kept for manual debugging only,
 * and is stripped from the address bar so the token never lands in browser
 * history if a developer hits the route by hand.
 */
function bootstrapPrintToken(): void {
  if (typeof window === 'undefined') return;

  const injectedToken = window.__REPORT_PRINT_TOKEN__;
  if (typeof injectedToken === 'string' && injectedToken.length > 0) {
    useAuthStore.getState().setAccessToken(injectedToken);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    useAuthStore.getState().setAccessToken(token);
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.hash}`);
  }
}

bootstrapPrintToken();

/**
 * Print-mode renderer for evaluation report runs. Backend Playwright navigates
 * here, injects a one-shot auth token before the app boots, the page fetches
 * the report artifact, then renders the SAME `PlatformReportView` the live UI
 * mounts — only with `printMode` set, so it skips Tabs/actions, expands every
 * collapsible (transcripts), and stacks Detailed-tab sections inline.
 *
 * Readiness signal (`body[data-report-ready="true"]`) only fires once fonts
 * are loaded AND `document.documentElement.scrollHeight` has been stable for
 * `HEIGHT_STABLE_WINDOW_MS`, so Playwright never snapshots a half-painted page.
 *
 * Single-renderer guarantee: there is one component (`PlatformReportView`) that
 * draws both the live UI's Detailed tab and the PDF. They cannot drift.
 */
export function PrintReportRun() {
  const { reportRunId } = useParams<{ reportRunId: string }>();
  const [report, setReport] = useState<PlatformRunReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add(PRINT_BODY_CLASS);

    // Force light theme for the print artifact. The app's `index.html` inline
    // bootstrap reads `prefers-color-scheme` when no localStorage entry exists
    // — headless Chromium can come up either way depending on the host OS, so
    // a stale dark-mode rendering would silently ship a black-on-white PDF.
    // We override `data-theme` AND clear the inline `backgroundColor` the
    // bootstrap stamps on <html>, then restore both on unmount so navigating
    // away in dev doesn't strand the user in light mode.
    const html = document.documentElement;
    const prevTheme = html.getAttribute('data-theme');
    const prevInlineBg = html.style.backgroundColor;
    html.setAttribute('data-theme', 'light');
    html.style.backgroundColor = '';

    return () => {
      document.body.classList.remove(PRINT_BODY_CLASS);
      document.body.removeAttribute('data-report-ready');
      document.body.removeAttribute('data-report-error');
      if (prevTheme) html.setAttribute('data-theme', prevTheme);
      else html.removeAttribute('data-theme');
      html.style.backgroundColor = prevInlineBg;
    };
  }, []);

  useEffect(() => {
    if (!reportRunId) {
      setError('Missing reportRunId in URL');
      return;
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
  }, [reportRunId]);

  // Robust readiness gate: wait for (a) the report payload to render, (b)
  // fonts to load (no FOUT-mid-snapshot), then (c) the page height to settle
  // for `HEIGHT_STABLE_WINDOW_MS` so any deferred layout (charts, table
  // wrapping, late-mounted sections) has committed.
  useEffect(() => {
    if (!report) return;

    let cancelled = false;
    let pollHandle: number | null = null;
    const start = performance.now();

    async function signalWhenStable() {
      try {
        if (typeof document.fonts !== 'undefined') {
          await document.fonts.ready;
        }
      } catch {
        // Font loading failures are non-fatal — proceed to height-stability.
      }
      if (cancelled) return;

      let lastHeight = document.documentElement.scrollHeight;
      let lastChange = performance.now();

      const poll = () => {
        if (cancelled) return;
        const now = performance.now();
        const currentHeight = document.documentElement.scrollHeight;
        if (currentHeight !== lastHeight) {
          lastHeight = currentHeight;
          lastChange = now;
        }
        const stableFor = now - lastChange;
        const elapsed = now - start;
        if (stableFor >= HEIGHT_STABLE_WINDOW_MS || elapsed >= READINESS_TIMEOUT_MS) {
          document.body.setAttribute('data-report-ready', 'true');
          return;
        }
        pollHandle = window.requestAnimationFrame(poll);
      };
      pollHandle = window.requestAnimationFrame(poll);
    }

    void signalWhenStable();

    return () => {
      cancelled = true;
      if (pollHandle !== null) cancelAnimationFrame(pollHandle);
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
      <div className="report-print-container min-h-screen bg-[var(--bg-primary)] p-6">
        <div className="rounded-md border border-[var(--color-error)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--color-error)]">
          Failed to load report: {error}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="report-print-container min-h-screen bg-[var(--bg-primary)] p-6">
        <div className="text-sm text-[var(--text-muted)]">Loading report…</div>
      </div>
    );
  }

  return (
    <div className="report-print-container min-h-screen bg-[var(--bg-primary)] px-6 py-6">
      <PlatformReportView report={report} printMode />
    </div>
  );
}

export default PrintReportRun;
