/**
 * Page metadata registry for PageSurface header icon + title.
 *
 * Defaults live in `PAGE_METADATA`. Per-app overrides arrive via
 * `apps.config.pageIcons` / `pageTitles` and are layered through
 * `resolvePageMetadata`.
 */
import * as LucideIcons from 'lucide-react';
import {
  ListChecks,
  MessagesSquare,
  ShieldAlert,
  FileText,
  ScrollText,
  ChartArea,
  LayoutDashboard,
  LayoutGrid,
  Settings,
  Tags,
  PhoneIncoming,
  UserRound,
  DollarSign,
  CalendarClock,
  Users,
  HelpCircle,
  Workflow,
  Plug,
  Database,
  Search,
  Users2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useCurrentAppConfig } from '@/hooks';
import type { AppConfig, PageType } from '@/types';

export type { PageType };

export interface PageMetadataEntry {
  icon: LucideIcon;
  /** Empty string when title is entity-derived (detail pages). */
  title: string;
}

export const PAGE_METADATA: Record<PageType, PageMetadataEntry> = {
  runs:               { icon: ListChecks,      title: 'Runs' },
  runDetail:          { icon: ListChecks,      title: '' },
  threadDetail:       { icon: MessagesSquare,  title: '' },
  adversarialDetail:  { icon: ShieldAlert,     title: '' },
  evaluators:         { icon: FileText,        title: 'Evaluators' },
  evaluatorDetail:    { icon: FileText,        title: '' },
  logs:               { icon: ScrollText,      title: 'Logs' },
  analytics:          { icon: ChartArea,       title: 'Analytics' },
  analyticsChart:     { icon: ChartArea,       title: '' },
  analyticsDashboard: { icon: LayoutDashboard, title: '' },
  settings:           { icon: Settings,        title: 'Settings' },
  tags:               { icon: Tags,            title: 'Tag Management' },
  listing:            { icon: LayoutGrid,      title: 'Listing' },
  listingDetail:      { icon: LayoutGrid,      title: '' },
  callDetail:         { icon: PhoneIncoming,   title: '' },
  leadDetail:         { icon: UserRound,       title: '' },
  cost:               { icon: DollarSign,      title: 'Cost' },
  scheduledJobs:      { icon: CalendarClock,   title: 'Scheduled Jobs' },
  adminUsers:         { icon: Users,           title: 'Admin Users' },
  sherlock:           { icon: Search,          title: 'Sherlock' },
  campaigns:          { icon: Workflow,        title: 'Campaigns' },
  connections:        { icon: Plug,            title: 'Connections' },
  datasets:           { icon: Database,        title: 'Datasets' },
  datasetDetail:      { icon: Database,        title: '' },
  cohorts:            { icon: Users2,          title: 'Cohorts' },
  chat:               { icon: MessagesSquare,  title: 'Chat' },
};

const LUCIDE_REGISTRY = LucideIcons as unknown as Record<string, LucideIcon>;

export function resolveLucide(name: string | undefined | null): LucideIcon {
  if (!name) return HelpCircle;
  const icon = LUCIDE_REGISTRY[name];
  return (typeof icon === 'function' || typeof icon === 'object' ? icon : HelpCircle) as LucideIcon;
}

export function resolvePageMetadata(
  pageType: PageType,
  appConfig: AppConfig | null | undefined,
): PageMetadataEntry {
  const defaults = PAGE_METADATA[pageType];
  const iconOverride = appConfig?.pageIcons?.[pageType];
  const titleOverride = appConfig?.pageTitles?.[pageType];
  return {
    icon: iconOverride ? resolveLucide(iconOverride) : defaults.icon,
    title: titleOverride ?? defaults.title,
  };
}

export function usePageMetadata(pageType: PageType): PageMetadataEntry {
  const appConfig = useCurrentAppConfig();
  return resolvePageMetadata(pageType, appConfig);
}
