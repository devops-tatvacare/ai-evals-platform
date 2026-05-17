import { hasReportableRun, type AnyRunStatus } from '@/utils/runLifecycle';
import { RunDetailTabStrip } from '../RunDetailTabStrip';
import type { RunDetailTab } from '../types';

interface TabDescriptor extends RunDetailTab {
  /**
   * Per-tab visibility flag for app-supplied extras. Tabs with `visible:
   * false` are dropped from the strip. Defaults to `true`. Status gating
   * for the built-in `reportTab` is handled by this component — entries
   * don't need to set `visible` for it.
   */
  visible?: boolean;
}

interface Props {
  status: AnyRunStatus;
  resultsTab: TabDescriptor;
  /** When provided, the Report tab is only rendered for reviewable runs. */
  reportTab?: TabDescriptor;
  /** Extra tabs an entry mounts after Report (e.g. Baseline, History). */
  extraTabs?: TabDescriptor[];
  defaultTab?: string;
}

/**
 * Status-aware wrapper around `RunDetailTabStrip`. Single home of run-detail
 * tab-visibility logic — the strip itself never decides what to show. Entries
 * compose their tab descriptors and this component drops anything that isn't
 * meaningful for the current status.
 */
export function RunDetailTabs({
  status,
  resultsTab,
  reportTab,
  extraTabs = [],
  defaultTab,
}: Props) {
  const tabs: RunDetailTab[] = [stripVisibility(resultsTab)];

  if (reportTab && hasReportableRun(status) && reportTab.visible !== false) {
    tabs.push(stripVisibility(reportTab));
  }

  for (const tab of extraTabs) {
    if (tab.visible === false) continue;
    tabs.push(stripVisibility(tab));
  }

  return <RunDetailTabStrip tabs={tabs} defaultTab={defaultTab} />;
}

function stripVisibility(tab: TabDescriptor): RunDetailTab {
  const { visible: _visible, ...rest } = tab;
  void _visible;
  return rest;
}
