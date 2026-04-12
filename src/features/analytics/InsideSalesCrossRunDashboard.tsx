import { useEffect, useMemo } from 'react';
import {
  AlertCircle,
  BarChart3,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AppId } from '@/types';
import type { InsideSalesCrossRunAnalytics } from '@/types/insideSalesCrossRun';
import { useCrossRunStore } from '@/stores';
import { EmptyState, Tabs, Button } from '@/components/ui';
import { timeAgo } from '@/utils/evalFormatters';
import { routes } from '@/config/routes';
import { useNavigate } from 'react-router-dom';
import { useResolvedColor } from '@/hooks/useResolvedColor';
import Heatmap from '@/features/evalRuns/components/crossRun/Heatmap';
import SectionHeader from '@/features/evalRuns/components/report/shared/SectionHeader';
import { IssuesTab } from '@/features/evalRuns/components/crossRun';

interface Props {
  appId: AppId;
}

export function InsideSalesCrossRunDashboard({ appId }: Props) {
  const navigate = useNavigate();
  const entry = useCrossRunStore((s) => s.entries[appId]);
  const loadAnalytics = useCrossRunStore((s) => s.loadAnalytics);
  const refreshAnalytics = useCrossRunStore((s) => s.refreshAnalytics);

  const data = (entry?.data as InsideSalesCrossRunAnalytics | null) ?? null;
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
          title="Inside Sales Cross-Run Analytics"
          description="Compare QA score trends, dimension consistency, compliance drift, and repeated coaching themes across report-bearing runs."
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
        <p className="text-sm text-[var(--text-secondary)]">Aggregating inside sales report caches...</p>
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
          <Button variant="secondary" size="sm" onClick={() => refreshAnalytics(appId)}>
            Update
          </Button>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)]">
        Analyzing {data.stats.totalRuns} of {data.stats.allRuns} total runs (only runs with generated reports)
      </p>

      <InsideSalesStatCards stats={data.stats} />

      <Tabs
        tabs={[
          {
            id: 'issues',
            label: 'Issues & Recommendations',
            content: (
              <IssuesTab
                appId={appId}
                data={data.issuesAndRecommendations}
                stats={{
                  totalRuns: data.stats.totalRuns,
                  allRuns: data.stats.allRuns,
                  totalThreads: data.stats.evaluatedCalls,
                  totalAdversarialTests: 0,
                  avgHealthScore: data.stats.avgQaScore,
                  avgGrade: 'N/A',
                  avgBreakdown: data.stats.avgDimensionScores,
                  adversarialPassRate: null,
                }}
                healthTrend={data.scoreTrend.map((point) => ({
                  runId: point.runId,
                  runName: point.runName,
                  evalType: 'call_quality',
                  createdAt: point.createdAt,
                  healthScore: point.avgQaScore,
                  grade: 'N/A',
                  breakdown: point.dimensionScores,
                }))}
              />
            ),
          },
          {
            id: 'trends',
            label: 'Scores & Dimensions',
            content: (
              <div className="space-y-6">
                <InsideSalesTrendChart trend={data.scoreTrend} />
                <InsideSalesDimensionHeatmapPanel
                  analytics={data}
                  onRunClick={(runId) => navigate(routes.insideSales.runDetail(runId))}
                />
              </div>
            ),
          },
          {
            id: 'compliance',
            label: 'Compliance & Signals',
            content: (
              <div className="space-y-6">
                <InsideSalesComplianceHeatmapPanel
                  analytics={data}
                  onRunClick={(runId) => navigate(routes.insideSales.runDetail(runId))}
                />
                <InsideSalesFlagRollupsPanel analytics={data} />
              </div>
            ),
          },
        ]}
        defaultTab="issues"
      />
    </div>
  );
}

function InsideSalesStatCards({ stats }: { stats: InsideSalesCrossRunAnalytics['stats'] }) {
  const cards = [
    { label: 'Runs Analyzed', value: stats.totalRuns, subtitle: `${stats.totalRuns} of ${stats.allRuns} runs have reports` },
    { label: 'Total Calls', value: stats.totalCalls },
    { label: 'Avg QA Score', value: stats.avgQaScore.toFixed(1), color: scoreColor(stats.avgQaScore) },
    { label: 'Avg Compliance', value: `${stats.avgCompliancePassRate.toFixed(1)}%`, color: scoreColor(stats.avgCompliancePassRate) },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{card.label}</p>
            <p className="text-xl font-extrabold mt-0.5 leading-tight" style={{ color: card.color || 'var(--text-primary)' }}>
              {card.value}
            </p>
            {card.subtitle && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{card.subtitle}</p>}
          </div>
        ))}
      </div>
      {Object.keys(stats.avgDimensionScores).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(stats.avgDimensionScores).map(([key, value]) => (
            <div key={key} className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{formatKey(key)}</p>
              <p className="text-xl font-extrabold mt-0.5 leading-tight" style={{ color: scoreColor(value) }}>
                {value.toFixed(1)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InsideSalesTrendChart({ trend }: { trend: InsideSalesCrossRunAnalytics['scoreTrend'] }) {
  const gridColor = useResolvedColor('var(--border-subtle)');
  const textColor = useResolvedColor('var(--text-muted)');

  const chartData = useMemo(() => (
    trend.map((point) => ({
      name: point.runName || point.runId.slice(0, 8),
      date: point.createdAt
        ? new Date(point.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '',
      avgQaScore: point.avgQaScore,
      compliancePassRate: point.compliancePassRate,
    }))
  ), [trend]);

  if (trend.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No score trend data"
        description="No runs with generated reports found."
        compact
      />
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="QA Score Trend"
        description="Average QA score and compliance pass rate across inside sales runs."
      />
      <div className="bg-[var(--bg-primary)] rounded border border-[var(--border-subtle)] p-3">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: textColor }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: textColor }} />
            <RechartsTooltip
              contentStyle={{
                fontSize: 12,
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
              }}
              labelFormatter={(_label, payload) => (payload?.[0]?.payload?.name as string) || ''}
            />
            <Line type="monotone" dataKey="avgQaScore" stroke="var(--color-accent-indigo)" strokeWidth={2.5} dot={{ r: 3 }} name="Avg QA Score" />
            <Line type="monotone" dataKey="compliancePassRate" stroke="var(--color-accent-teal)" strokeWidth={2} dot={{ r: 3 }} name="Compliance Pass Rate" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InsideSalesDimensionHeatmapPanel({
  analytics,
  onRunClick,
}: {
  analytics: InsideSalesCrossRunAnalytics;
  onRunClick: (runId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Dimension Consistency"
        description="Each cell shows the average score for a QA dimension in a specific run."
      />
      <Heatmap
        columnHeaders={analytics.dimensionHeatmap.runs.map((run) => ({
          id: run.runId,
          label: run.runName || run.runId.slice(0, 8),
          sublabel: run.createdAt ? new Date(run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
        }))}
        rows={analytics.dimensionHeatmap.rows.map((row) => ({
          id: row.key,
          label: row.label,
          sublabel: `Avg ${row.avgScore.toFixed(1)} / ${row.maxPossible}`,
          cells: row.cells.map((value) => value == null ? null : value / row.maxPossible),
          average: row.maxPossible > 0 ? row.avgScore / row.maxPossible : 0,
        }))}
        rowHeaderLabel="Dimension"
        onColumnClick={onRunClick}
        emptyMessage="No dimension data found in report caches."
      />
    </div>
  );
}

function InsideSalesComplianceHeatmapPanel({
  analytics,
  onRunClick,
}: {
  analytics: InsideSalesCrossRunAnalytics;
  onRunClick: (runId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Compliance Drift"
        description="Each cell shows the gate pass rate for a specific run."
      />
      <Heatmap
        columnHeaders={analytics.complianceHeatmap.runs.map((run) => ({
          id: run.runId,
          label: run.runName || run.runId.slice(0, 8),
          sublabel: run.createdAt ? new Date(run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
        }))}
        rows={analytics.complianceHeatmap.rows.map((row) => ({
          id: row.key,
          label: row.label,
          cells: row.cells,
          average: row.avgPassRate,
        }))}
        rowHeaderLabel="Gate"
        onColumnClick={onRunClick}
        emptyMessage="No compliance data found in report caches."
      />
    </div>
  );
}

function InsideSalesFlagRollupsPanel({ analytics }: { analytics: InsideSalesCrossRunAnalytics }) {
  const behavioral = Object.entries(analytics.flagRollups.behavioral);
  const outcomes = Object.entries(analytics.flagRollups.outcomes);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Behavioral Signals & Outcomes"
        description="Rolls up relevant/present signal counts across all analyzed runs."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Behavioral Flags</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {behavioral.map(([key, flag]) => (
              <div key={key} className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded p-3">
                <div className="text-[11px] uppercase text-[var(--text-secondary)]">{flag.label}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: scoreColor(flag.relevant > 0 ? (flag.present / flag.relevant) * 100 : 0) }}>
                  {flag.present}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)]">{flag.relevant} relevant · {flag.notRelevant} not relevant</div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Outcome Flags</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {outcomes.map(([key, flag]) => (
              <div key={key} className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded p-3">
                <div className="text-[11px] uppercase text-[var(--text-secondary)]">{flag.label}</div>
                <div className="text-lg font-bold mt-1 text-[var(--text-primary)]">{flag.attempted}</div>
                <div className="text-[11px] text-[var(--text-secondary)]">{flag.relevant} relevant · {flag.notRelevant} not relevant</div>
                {flag.accepted > 0 && (
                  <div className="text-[11px] text-[var(--text-secondary)]">{flag.accepted} accepted</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--color-success)';
  if (score >= 65) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\s/, '')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
