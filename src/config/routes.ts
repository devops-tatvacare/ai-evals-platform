/**
 * Centralized route path constants and builder functions.
 * Use these instead of hardcoded string literals.
 */
import {
  APP_CONFIG_FALLBACKS,
  APP_IDS,
  DEFAULT_APP,
  type AppId,
  type AppNavigationConfig,
} from '../types/app.types';

export const routes = {
  login: '/login',
  signup: '/signup',
  adminRoot: '/admin',
  adminUsers: '/admin/users',
  adminCost: '/admin/cost',
  adminScheduledJobs: '/admin/scheduled-jobs',
  adminSherlock: '/admin/sherlock',
  adminSherlockToolCall: (toolCallId: string) => `/admin/sherlock/${toolCallId}`,
  adminSherlockConfig: '/admin/sherlock-config',
  profile: '/profile',
  guide: '/guide',
  printReportRun: (reportRunId: string) => `/print/report-runs/${reportRunId}`,
  voiceRx: {
    home: "/",
    listing: (id: string) => `/listing/${id}`,
    dashboard: "/dashboard",
    evaluators: '/evaluators',
    runs: "/runs",
    runDetail: (runId: string) => `/runs/${runId}`,
    logs: "/logs",
    settings: "/settings",
    analytics: "/analytics",
    analyticsChart: (chartId: string) => `/analytics/charts/${chartId}`,
    analyticsDashboard: (dashboardId: string) => `/analytics/dashboards/${dashboardId}`,
  },
  kaira: {
    home: "/kaira",
    chat: "/kaira/chat",
    chatSession: (chatId: string) => `/kaira/chat/${chatId}`,
    dashboard: "/kaira/dashboard",
    evaluators: '/kaira/evaluators',
    runs: "/kaira/runs",
    runDetail: (runId: string) => `/kaira/runs/${runId}`,
    adversarialDetail: (runId: string, evalId: string) =>
      `/kaira/runs/${runId}/adversarial/${evalId}`,
    threadDetail: (threadId: string, runId?: string) =>
      runId ? `/kaira/threads/${threadId}?runId=${runId}` : `/kaira/threads/${threadId}`,
    logs: "/kaira/logs",
    settings: "/kaira/settings",
    settingsTags: "/kaira/settings/tags",
    analytics: "/kaira/analytics",
    analyticsChart: (chartId: string) => `/kaira/analytics/charts/${chartId}`,
    analyticsDashboard: (dashboardId: string) => `/kaira/analytics/dashboards/${dashboardId}`,
  },
  insideSales: {
    home: '/inside-sales',
    listing: '/inside-sales',
    /** Listing URL scoped to a specific collection tab. `tab=leads` is the
     *  default and returns the bare path; other values are passed as a
     *  query param so deep links and "back" buttons stay truthful. */
    listingForTab: (tab: 'leads' | 'calls') => (tab === 'leads' ? '/inside-sales' : '/inside-sales?tab=calls'),
    evaluators: '/inside-sales/evaluators',
    evaluatorDetail: (id: string) => `/inside-sales/evaluators/${id}`,
    runs: '/inside-sales/runs',
    runDetail: (runId: string) => `/inside-sales/runs/${runId}`,
    callDetail: (runId: string, callId: string) => `/inside-sales/runs/${runId}/calls/${callId}`,
    callView: (activityId: string) => `/inside-sales/calls/${activityId}`,
    leadDetail: (prospectId: string) => `/inside-sales/leads/${prospectId}`,
    dashboard: '/inside-sales/dashboard',
    logs: '/inside-sales/logs',
    settings: '/inside-sales/settings',
    analytics: '/inside-sales/analytics',
    analyticsChart: (chartId: string) => `/inside-sales/analytics/charts/${chartId}`,
    analyticsDashboard: (dashboardId: string) => `/inside-sales/analytics/dashboards/${dashboardId}`,
    campaigns: '/inside-sales/orchestration',
    campaignBuilder: (workflowId: string) => `/inside-sales/orchestration/workflows/${workflowId}`,
    campaignRuns: '/inside-sales/orchestration/runs',
    campaignRunDetail: (runId: string) => `/inside-sales/orchestration/runs/${runId}`,
    connections: '/inside-sales/orchestration/connections',
    datasets: '/inside-sales/orchestration/datasets',
    datasetDetail: (datasetId: string) => `/inside-sales/orchestration/datasets/${datasetId}`,
  },
};

const appNavigationRegistry = new Map<string, AppNavigationConfig>(
  APP_IDS.map((appId) => [appId, APP_CONFIG_FALLBACKS[appId].navigation]),
);

function isKnownAppId(appId: string): appId is AppId {
  return appId in APP_CONFIG_FALLBACKS;
}

function fallbackNavigation(): AppNavigationConfig {
  return APP_CONFIG_FALLBACKS[DEFAULT_APP].navigation;
}

function navigationForApp(appId: string): AppNavigationConfig {
  if (!isKnownAppId(appId)) {
    return fallbackNavigation();
  }
  return appNavigationRegistry.get(appId) ?? APP_CONFIG_FALLBACKS[appId].navigation;
}

function fillPathTemplate(
  template: string | null | undefined,
  params: Record<string, string | undefined>,
): string | null {
  if (!template) return null;

  let path = template;
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    path = path.replaceAll(`:${key}`, value);
  }

  return path.includes('/:') ? null : path;
}

function templateToRegExp(template: string | null | undefined): RegExp | null {
  if (!template) return null;

  const pattern = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z0-9_]+)/g, '[^/]+');

  return new RegExp(`^${pattern}$`);
}

function matchesOwnedPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function stripTemplateSuffix(template: string | null | undefined, suffix: string): string | null {
  if (!template || !template.endsWith(suffix)) {
    return null;
  }
  return template.slice(0, -suffix.length);
}

export function syncAppNavigation(appId: string, navigation?: Partial<AppNavigationConfig> | null): void {
  if (!isKnownAppId(appId)) {
    return;
  }

  const fallback = APP_CONFIG_FALLBACKS[appId].navigation;
  appNavigationRegistry.set(appId, {
    ...fallback,
    ...navigation,
    ownedPathPrefixes: navigation?.ownedPathPrefixes ?? fallback.ownedPathPrefixes,
  });
}

export function resetAppNavigationRegistry(): void {
  appNavigationRegistry.clear();
  APP_IDS.forEach((appId) => {
    appNavigationRegistry.set(appId, APP_CONFIG_FALLBACKS[appId].navigation);
  });
}

export function homeRouteForApp(appId: string): string {
  return navigationForApp(appId).homePath;
}

export function settingsRouteForApp(appId: string): string {
  return navigationForApp(appId).settingsPath ?? fallbackNavigation().settingsPath ?? routes.voiceRx.settings;
}

export function firstAccessibleAppId(appAccess: string[]): AppId {
  return appAccess.find((appId): appId is AppId => isKnownAppId(appId)) ?? DEFAULT_APP;
}

export function firstAccessibleRoute(appAccess: string[]): string {
  return homeRouteForApp(firstAccessibleAppId(appAccess));
}

export function adminHomeRoute(options: {
  canManageUsers: boolean;
  canViewCost: boolean;
  canManageSchedules?: boolean;
}): string | null {
  if (options.canManageUsers) {
    return routes.adminUsers;
  }
  if (options.canViewCost) {
    return routes.adminCost;
  }
  if (options.canManageSchedules) {
    return routes.adminScheduledJobs;
  }
  return null;
}

/** Resolve the run detail path for a given appId. */
export function runDetailForApp(appId: string, runId: string): string {
  return (
    fillPathTemplate(navigationForApp(appId).runDetailPath, { runId }) ??
    fillPathTemplate(fallbackNavigation().runDetailPath, { runId }) ??
    routes.voiceRx.runDetail(runId)
  );
}

export function evaluatorDetailForApp(appId: string, id: string): string | null {
  return fillPathTemplate(navigationForApp(appId).evaluatorDetailPath, { id });
}

/** Resolve the evaluators list path for a given appId. Derived from the evaluator-detail template. */
export function evaluatorsListForApp(appId: string): string | null {
  const template = navigationForApp(appId).evaluatorDetailPath;
  if (!template) return null;
  const stripped = template.replace(/\/:id$/, '');
  return stripped === template ? null : stripped;
}

export function adversarialDetailForApp(appId: string, runId: string, evalId: string): string | null {
  return fillPathTemplate(navigationForApp(appId).adversarialDetailPath, { runId, evalId });
}

/** Resolve the runs list path for a given appId. */
export function runsForApp(appId: string): string {
  return navigationForApp(appId).runsPath ?? fallbackNavigation().runsPath ?? routes.voiceRx.runs;
}

/** Resolve the API logs path for a given appId. */
export function apiLogsForApp(appId: string): string {
  return navigationForApp(appId).logsPath ?? fallbackNavigation().logsPath ?? routes.voiceRx.logs;
}

/** Resolve the analytics dashboard path for a given appId. */
export function analyticsDashboardForApp(appId: string, dashboardId: string): string {
  return (
    fillPathTemplate(navigationForApp(appId).analyticsDashboardPath, { dashboardId }) ??
    fillPathTemplate(fallbackNavigation().analyticsDashboardPath, { dashboardId }) ??
    routes.voiceRx.analyticsDashboard(dashboardId)
  );
}

export function analyticsChartForApp(appId: string, chartId: string): string {
  return (
    fillPathTemplate(navigationForApp(appId).analyticsChartPath, { chartId }) ??
    fillPathTemplate(fallbackNavigation().analyticsChartPath, { chartId }) ??
    routes.voiceRx.analyticsChart(chartId)
  );
}

export function analyticsLibraryForApp(appId: string): string {
  return (
    stripTemplateSuffix(navigationForApp(appId).analyticsChartPath, '/charts/:chartId') ??
    stripTemplateSuffix(navigationForApp(appId).analyticsDashboardPath, '/dashboards/:dashboardId') ??
    stripTemplateSuffix(fallbackNavigation().analyticsChartPath, '/charts/:chartId') ??
    stripTemplateSuffix(fallbackNavigation().analyticsDashboardPath, '/dashboards/:dashboardId') ??
    routes.voiceRx.analytics
  );
}

export function reportWizardForApp(appId: string, blueprintId: string): string {
  const basePath =
    navigationForApp(appId).reportWizardPath ??
    fallbackNavigation().reportWizardPath ??
    '/reports/generate';
  const params = new URLSearchParams({ template: blueprintId });

  return `${basePath}?${params.toString()}`;
}

export function threadDetailForApp(appId: string, threadId: string, runId?: string): string | null {
  return fillPathTemplate(navigationForApp(appId).threadDetailPath, { threadId, runId });
}

export function inferAppIdFromPath(pathname: string, candidateAppIds: string[] = APP_IDS): AppId | null {
  for (const appId of candidateAppIds) {
    if (!isKnownAppId(appId)) {
      continue;
    }
    const navigation = navigationForApp(appId);
    if (pathname === navigation.homePath) {
      return appId;
    }
    if (navigation.ownedPathPrefixes.some((prefix) => matchesOwnedPrefix(pathname, prefix))) {
      return appId;
    }
  }

  return null;
}

/** Check if a pathname is a run detail page for a given runId (Kaira or VoiceRx). */
export function isRunDetailPath(pathname: string, runId?: string): boolean {
  if (runId) {
    return APP_IDS.some((appId) => pathname === runDetailForApp(appId, runId));
  }

  return APP_IDS.some((appId) => {
    const pattern = templateToRegExp(navigationForApp(appId).runDetailPath);
    return pattern?.test(pathname) ?? false;
  });
}
