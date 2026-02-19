/**
 * Centralized route path constants and builder functions.
 * Use these instead of hardcoded string literals.
 */
export const routes = {
  voiceRx: {
    home: '/',
    upload: '/upload',
    listing: (id: string) => `/listing/${id}`,
    dashboard: '/dashboard',
    runs: '/runs',
    runDetail: (runId: string) => `/runs/${runId}`,
    logs: '/logs',
    apiLogs: '/api-logs',
    settings: '/settings',
  },
  kaira: {
    home: '/kaira',
    chat: '/kaira/chat',
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

/** Resolve the run detail path for a given appId. */
export function runDetailForApp(appId: string, runId: string): string {
  if (appId === 'kaira-bot') {
    return routes.kaira.runDetail(runId);
  }
  return routes.voiceRx.runDetail(runId);
}

/** Resolve the API logs path for a given appId. */
export function apiLogsForApp(appId: string): string {
  if (appId === 'kaira-bot') {
    return routes.kaira.logs;
  }
  return routes.voiceRx.apiLogs;
}

/** Check if a pathname is a run detail page for a given runId (Kaira or VoiceRx). */
export function isRunDetailPath(pathname: string, runId?: string): boolean {
  if (runId) {
    return pathname === `/kaira/runs/${runId}` || pathname === `/runs/${runId}`;
  }
  return /^\/kaira\/runs\/[^/]+$/.test(pathname) || /^\/runs\/[^/]+$/.test(pathname);
}
