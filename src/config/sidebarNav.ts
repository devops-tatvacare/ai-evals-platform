/**
 * Single source of truth for sidebar navigation items per app.
 * Both collapsed and expanded sidebar states consume this config.
 */
import {
  LayoutDashboard,
  LayoutGrid,
  FileText,
  ListChecks,
  ScrollText,
  ChartArea,
  Users,
  DollarSign,
  CalendarClock,
  Workflow,
  Plug,
  Sparkles,
} from 'lucide-react';
import { SherlockIcon } from '@/components/ui';
import { routes } from './routes';
import type { AppId } from '@/types';

export interface SidebarNavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Pass `end` to NavLink — only exact match activates (needed for index routes). */
  end?: boolean;
  /** Sidebar-only visibility toggle so routes can remain available without exposure in nav. */
  hidden?: boolean;
  /** Custom active-state predicate. When set, overrides NavLink's default
   *  prefix-match. Use for items whose URL is a prefix of a *sibling*
   *  sidebar entry — e.g. Campaigns at `/orchestration` and Connections at
   *  `/orchestration/connections` would both light up under the default
   *  match. Return true when the item should appear selected. */
  activeWhen?: (pathname: string) => boolean;
}

/**
 * A labelled section of sidebar items. Used by surfaces (today: admin) that
 * benefit from grouped scanning. The renderer prints `title` above the
 * section's items; groups whose `items` array is empty after permission
 * gating are dropped before render so the data shape stays the source of
 * truth (no `if (group === 'analytics')` branches in the view).
 */
export interface SidebarNavGroup {
  id: string;
  title: string;
  items: SidebarNavItem[];
}

const VOICE_RX_NAV: SidebarNavItem[] = [
  { to: routes.voiceRx.dashboard, icon: LayoutDashboard, label: 'Dashboard', hidden: true },
  { to: routes.voiceRx.evaluators, icon: FileText, label: 'Evaluators' },
  { to: routes.voiceRx.runs, icon: ListChecks, label: 'Runs' },
  { to: routes.voiceRx.logs, icon: ScrollText, label: 'Logs' },
  { to: routes.voiceRx.analytics, icon: ChartArea, label: 'Analytics' },
];

const KAIRA_NAV: SidebarNavItem[] = [
  { to: routes.kaira.dashboard, icon: LayoutDashboard, label: 'Dashboard', hidden: true },
  { to: routes.kaira.evaluators, icon: FileText, label: 'Evaluators' },
  { to: routes.kaira.runs, icon: ListChecks, label: 'Runs' },
  { to: routes.kaira.logs, icon: ScrollText, label: 'Logs' },
  { to: routes.kaira.analytics, icon: ChartArea, label: 'Analytics' },
];

// Orchestration sub-routes that visually belong under "Campaigns" — clicking
// into a campaign builder or campaign run should keep Campaigns highlighted.
// Connections and Datasets are siblings, NOT children, so they're excluded.
const ORCHESTRATION_ROOT = routes.insideSales.campaigns;
const ORCHESTRATION_CAMPAIGN_CHILDREN = [
  `${ORCHESTRATION_ROOT}/workflows`,
  `${ORCHESTRATION_ROOT}/runs`,
];
const isCampaignsActive = (pathname: string): boolean => {
  if (pathname === ORCHESTRATION_ROOT) return true;
  return ORCHESTRATION_CAMPAIGN_CHILDREN.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
};

const INSIDE_SALES_NAV: SidebarNavItem[] = [
  { to: routes.insideSales.listing, icon: LayoutGrid, label: 'Listing', end: true },
  { to: routes.insideSales.dashboard, icon: LayoutDashboard, label: 'Dashboard', hidden: true },
  { to: routes.insideSales.evaluators, icon: FileText, label: 'Evaluators' },
  { to: routes.insideSales.runs, icon: ListChecks, label: 'Runs' },
  {
    to: routes.insideSales.campaigns,
    icon: Workflow,
    label: 'Campaigns',
    activeWhen: isCampaignsActive,
  },
  { to: routes.insideSales.logs, icon: ScrollText, label: 'Logs' },
  { to: routes.insideSales.analytics, icon: ChartArea, label: 'Analytics' },
];

const ADMIN_USERS_NAV: SidebarNavItem = {
  to: routes.adminUsers,
  icon: Users,
  label: 'User Management',
  end: true,
};

const ADMIN_COST_NAV: SidebarNavItem = {
  to: routes.adminCost,
  icon: DollarSign,
  label: 'Cost & Usage',
};

const ADMIN_SCHEDULED_JOBS_NAV: SidebarNavItem = {
  to: routes.adminScheduledJobs,
  icon: CalendarClock,
  label: 'Scheduled Jobs',
  end: true,
};

const ADMIN_SHERLOCK_NAV: SidebarNavItem = {
  to: routes.adminSherlock,
  icon: SherlockIcon,
  label: 'Sherlock',
};

const ADMIN_SHERLOCK_CONFIG_NAV: SidebarNavItem = {
  to: routes.adminSherlockConfig,
  icon: SherlockIcon,
  label: 'Sherlock Config',
};

const ADMIN_INTEGRATIONS_NAV: SidebarNavItem = {
  to: routes.adminIntegrations,
  icon: Plug,
  label: 'Integrations',
  end: true,
};

const ADMIN_AI_SETTINGS_NAV: SidebarNavItem = {
  to: routes.adminAiSettings,
  icon: Sparkles,
  label: 'Model Providers',
  end: true,
};

const NAV_BY_APP: Record<AppId, SidebarNavItem[]> = {
  'voice-rx': VOICE_RX_NAV,
  'kaira-bot': KAIRA_NAV,
  'inside-sales': INSIDE_SALES_NAV,
};

function getVisibleNavItems(items: SidebarNavItem[]): SidebarNavItem[] {
  return items.filter((item) => !item.hidden);
}

export function getNavItems(appId: AppId): SidebarNavItem[] {
  return getVisibleNavItems(NAV_BY_APP[appId] ?? VOICE_RX_NAV);
}

/**
 * Landing route for an app — the first visible sidebar entry. Used by the
 * Router to redirect bare app roots (e.g. `/`, `/kaira`) instead of hard-
 * coding to a specific page. Keeps hidden routes (Dashboard) reachable via
 * direct URL but off the default flow.
 */
export function landingRouteForApp(appId: AppId): string {
  const first = getNavItems(appId)[0];
  return first?.to ?? NAV_BY_APP[appId]?.[0]?.to ?? VOICE_RX_NAV[0].to;
}

interface AdminNavOptions {
  canManageUsers: boolean;
  canViewCost: boolean;
  canManageSchedules?: boolean;
  canManageOrchestration?: boolean;
  canEditConfiguration?: boolean;
}

/**
 * Admin sidebar grouped by capability. The renderer prints the `title` of
 * each group as a section heading. Per-item permission gates run inside the
 * group; groups whose `items` array is empty after gating are dropped so the
 * renderer never sees an empty section.
 *
 * Adding a new admin surface = append to the right group's items, set its
 * permission gate, and the renderer picks it up. New groups = add a new
 * `SidebarNavGroup` entry; no renderer change needed.
 */
export function getAdminNavGroups(options: AdminNavOptions): SidebarNavGroup[] {
  const groups: SidebarNavGroup[] = [
    {
      id: 'workspace',
      title: 'Workspace',
      items: gate([
        [options.canManageUsers, ADMIN_USERS_NAV],
      ]),
    },
    {
      id: 'operations',
      title: 'Operations',
      items: gate([
        [options.canManageSchedules, ADMIN_SCHEDULED_JOBS_NAV],
        [options.canManageOrchestration, ADMIN_INTEGRATIONS_NAV],
        [options.canEditConfiguration, ADMIN_AI_SETTINGS_NAV],
      ]),
    },
    {
      id: 'analytics',
      title: 'Analytics',
      items: gate([
        [options.canViewCost, ADMIN_COST_NAV],
        // Sherlock list/detail pages are gated by `AdminGuard` (any admin
        // access permission), mirrored here against user-mgmt access.
        [options.canManageUsers, ADMIN_SHERLOCK_NAV],
        [options.canManageUsers, ADMIN_SHERLOCK_CONFIG_NAV],
      ]),
    },
  ];
  return groups
    .map((group) => ({ ...group, items: getVisibleNavItems(group.items) }))
    .filter((group) => group.items.length > 0);
}

function gate(
  rows: Array<[boolean | undefined, SidebarNavItem]>,
): SidebarNavItem[] {
  return rows.filter(([allowed]) => Boolean(allowed)).map(([, item]) => item);
}
