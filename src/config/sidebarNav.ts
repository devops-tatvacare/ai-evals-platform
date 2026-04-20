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
} from 'lucide-react';
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

const INSIDE_SALES_NAV: SidebarNavItem[] = [
  { to: routes.insideSales.listing, icon: LayoutGrid, label: 'Listing', end: true },
  { to: routes.insideSales.dashboard, icon: LayoutDashboard, label: 'Dashboard', hidden: true },
  { to: routes.insideSales.evaluators, icon: FileText, label: 'Evaluators' },
  { to: routes.insideSales.runs, icon: ListChecks, label: 'Runs' },
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

export function getAdminNavItems(options: {
  canManageUsers: boolean;
  canViewCost: boolean;
}): SidebarNavItem[] {
  const items: SidebarNavItem[] = [];

  if (options.canManageUsers) {
    items.push(ADMIN_USERS_NAV);
  }
  if (options.canViewCost) {
    items.push(ADMIN_COST_NAV);
  }

  return getVisibleNavItems(items);
}
