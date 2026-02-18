/**
 * Centralized route path constants and builder functions.
 * Use these instead of hardcoded string literals.
 */
export const routes = {
  voiceRx: {
    home: '/',
    listing: (id: string) => `/listing/${id}`,
    dashboard: '/dashboard',
    runs: '/runs',
    logs: '/logs',
    settings: '/settings',
  },
  kaira: {
    home: '/kaira',
    dashboard: '/kaira/dashboard',
    runs: '/kaira/runs',
    runDetail: (runId: string) => `/kaira/runs/${runId}`,
    adversarialDetail: (runId: string, evalId: string) =>
      `/kaira/runs/${runId}/adversarial/${evalId}`,
    threadDetail: (threadId: string) => `/kaira/threads/${threadId}`,
    logs: '/kaira/logs',
    settings: '/kaira/settings',
    settingsTags: '/kaira/settings/tags',
  },
};

/** Check if a pathname is a run detail page for a given runId. */
export function isRunDetailPath(pathname: string, runId?: string): boolean {
  if (runId) {
    return pathname === `/kaira/runs/${runId}`;
  }
  return /^\/kaira\/runs\/[^/]+$/.test(pathname);
}
