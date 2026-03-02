import { useEffect } from 'react';
import { BarChart3, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { useCrossRunStore } from '@/stores';
import { EmptyState, Tabs, Button } from '@/components/ui';
import { timeAgo } from '@/utils/evalFormatters';
import {
  StatCardsRow,
  HealthTrendsTab,
  ComplianceHeatmapTab,
  AdversarialHeatmapTab,
  IssuesTab,
} from '../components/crossRun';

export default function Dashboard() {
  const data = useCrossRunStore((s) => s.data);
  const status = useCrossRunStore((s) => s.status);
  const error = useCrossRunStore((s) => s.error);
  const computedAt = useCrossRunStore((s) => s.computedAt);
  const isStale = useCrossRunStore((s) => s.isStale);
  const newRunsSince = useCrossRunStore((s) => s.newRunsSince);
  const loadAnalytics = useCrossRunStore((s) => s.loadAnalytics);
  const refreshAnalytics = useCrossRunStore((s) => s.refreshAnalytics);

  // Load cached analytics on mount
  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Full-page centered states (idle, loading, error)
  if (status === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={BarChart3}
          title="Cross-Run Aggregate Analytics"
          description="Analyze health score trends, rule compliance heatmaps, adversarial resilience, and recurring issues across all evaluation runs with generated reports."
          action={{
            label: 'Load Cross-Run Analytics',
            onClick: () => refreshAnalytics(),
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
        <p className="text-sm text-[var(--text-secondary)]">
          Aggregating data from report caches...
        </p>
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
            onClick: () => refreshAnalytics(),
          }}
        />
      </div>
    );
  }

  // Ready — data content
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
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
              onClick={() => refreshAnalytics()}
            >
              Refresh
            </Button>
          </div>
        )}
      </div>

      {/* Stale indicator */}
      {isStale && newRunsSince > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--surface-warning)] border border-[var(--border-warning)]">
          <AlertCircle className="h-3.5 w-3.5 text-[var(--color-warning)] shrink-0" />
          <span className="text-xs text-[var(--text-secondary)] flex-1">
            {newRunsSince} new run{newRunsSince > 1 ? 's' : ''} since last refresh
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshAnalytics()}
          >
            Update
          </Button>
        </div>
      )}

      {data && (
        <>
          {/* Coverage indicator */}
          <p className="text-xs text-[var(--text-muted)]">
            Analyzing {data.stats.totalRuns} of {data.stats.allRuns} total runs (only runs with generated reports)
          </p>

          {/* Stat cards — always visible */}
          <StatCardsRow stats={data.stats} />

          {/* Tabs */}
          <Tabs
            tabs={[
              {
                id: 'issues',
                label: 'Issues & Recommendations',
                content: (
                  <IssuesTab
                    data={data.issuesAndRecommendations}
                    stats={data.stats}
                    healthTrend={data.healthTrend}
                  />
                ),
              },
              {
                id: 'health',
                label: 'Health & Trends',
                content: (
                  <HealthTrendsTab
                    trend={data.healthTrend}
                    stats={data.stats}
                  />
                ),
              },
              {
                id: 'compliance',
                label: 'Rule Compliance',
                content: (
                  <ComplianceHeatmapTab heatmap={data.ruleComplianceHeatmap} />
                ),
              },
              ...(data.adversarialHeatmap
                ? [{
                    id: 'adversarial',
                    label: 'Adversarial',
                    content: (
                      <AdversarialHeatmapTab heatmap={data.adversarialHeatmap} />
                    ),
                  }]
                : []),
            ]}
            defaultTab="issues"
          />
        </>
      )}
    </div>
  );
}
