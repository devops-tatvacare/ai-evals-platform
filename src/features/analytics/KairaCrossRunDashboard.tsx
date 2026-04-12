import { useEffect } from 'react';
import { BarChart3, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import type { AppId } from '@/types';
import type { CrossRunAnalytics } from '@/types/crossRunAnalytics';
import { useCrossRunStore } from '@/stores';
import { EmptyState, Tabs, Button } from '@/components/ui';
import { timeAgo } from '@/utils/evalFormatters';
import {
  StatCardsRow,
  HealthTrendsTab,
  ComplianceHeatmapTab,
  AdversarialHeatmapTab,
  IssuesTab,
} from '@/features/evalRuns/components/crossRun';

interface Props {
  appId: AppId;
}

export function KairaCrossRunDashboard({ appId }: Props) {
  const entry = useCrossRunStore((s) => s.entries[appId]);
  const loadAnalytics = useCrossRunStore((s) => s.loadAnalytics);
  const refreshAnalytics = useCrossRunStore((s) => s.refreshAnalytics);

  const data = (entry?.data as CrossRunAnalytics | null) ?? null;
  const status = entry?.status ?? 'idle';
  const error = entry?.error ?? '';
  const computedAt = entry?.computedAt ?? '';
  const isStale = entry?.isStale ?? false;
  const newRunsSince = entry?.newRunsSince ?? 0;

  useEffect(() => {
    loadAnalytics(appId);
  }, [appId, loadAnalytics]);

  if (status === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={BarChart3}
          title="Cross-Run Aggregate Analytics"
          description="Analyze health score trends, rule compliance heatmaps, adversarial resilience, and recurring issues across all evaluation runs with generated reports."
          action={{
            label: 'Load Cross-Run Analytics',
            onClick: () => refreshAnalytics(appId),
          }}
        />
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 text-[var(--color-info)] animate-spin" />
        <p className="text-sm font-semibold text-[var(--text-primary)]">Loading analytics...</p>
        <p className="text-sm text-[var(--text-secondary)]">Aggregating data from report caches...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={BarChart3}
          title="Failed to load analytics"
          description={error || 'Something went wrong. Make sure you have runs with generated reports.'}
          action={{
            label: 'Retry',
            onClick: () => refreshAnalytics(appId),
          }}
        />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border-default)]">
        <h1 className="text-base font-bold text-[var(--text-primary)]">Cross-Run Analytics</h1>
        {computedAt && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">
              Last refreshed: {timeAgo(computedAt)}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => refreshAnalytics(appId)}
            >
              Refresh
            </Button>
          </div>
        )}
      </div>

      {isStale && newRunsSince > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--surface-warning)] border border-[var(--border-warning)]">
          <AlertCircle className="h-3.5 w-3.5 text-[var(--color-warning)] shrink-0" />
          <span className="text-xs text-[var(--text-secondary)] flex-1">
            {newRunsSince} new run{newRunsSince > 1 ? 's' : ''} since last refresh
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshAnalytics(appId)}
          >
            Update
          </Button>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Analyzing {data.stats.totalRuns} of {data.stats.allRuns} total runs (only runs with generated reports)
      </p>

      <StatCardsRow stats={data.stats} />

      <Tabs
        tabs={[
          {
            id: 'issues',
            label: 'Issues & Recommendations',
            content: (
              <IssuesTab
                appId={appId}
                data={data.issuesAndRecommendations}
                stats={data.stats}
                healthTrend={data.healthTrend}
              />
            ),
          },
          {
            id: 'health',
            label: 'Health & Trends',
            content: <HealthTrendsTab trend={data.healthTrend} stats={data.stats} />,
          },
          {
            id: 'compliance',
            label: 'Rule Compliance',
            content: <ComplianceHeatmapTab appId={appId} heatmap={data.ruleComplianceHeatmap} />,
          },
          ...(data.adversarialHeatmap
            ? [{
                id: 'adversarial',
                label: 'Adversarial',
                content: <AdversarialHeatmapTab appId={appId} heatmap={data.adversarialHeatmap} />,
              }]
            : []),
        ]}
        defaultTab="issues"
      />
    </div>
  );
}
