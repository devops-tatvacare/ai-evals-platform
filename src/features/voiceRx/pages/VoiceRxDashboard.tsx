import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Mic, CheckCircle, Clock, FlaskConical } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { fetchVoiceRxRuns } from '@/services/api/voiceRxHistoryApi';
import { useListingsStore } from '@/stores';
import { TAG_ACCENT_COLORS } from '@/utils/statusColors';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import type { EvaluatorRunHistory, HistoryScores } from '@/types';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function scoreColor(scores: HistoryScores | null): string {
  if (!scores || scores.overall_score == null) return 'var(--text-muted)';
  const val = typeof scores.overall_score === 'number'
    ? scores.overall_score
    : typeof scores.overall_score === 'string'
      ? parseFloat(scores.overall_score)
      : NaN;
  if (isNaN(val)) return 'var(--text-muted)';

  const meta = scores.metadata as Record<string, unknown> | null;
  const thresholds = meta?.thresholds as { pass?: number; warn?: number } | undefined;
  const pass = thresholds?.pass ?? 0.7;
  const warn = thresholds?.warn ?? 0.4;

  if (val >= pass) return 'var(--color-success)';
  if (val >= warn) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatScore(scores: HistoryScores | null): string {
  if (!scores || scores.overall_score == null) return '--';
  if (typeof scores.overall_score === 'boolean') return scores.overall_score ? 'Pass' : 'Fail';
  if (typeof scores.overall_score === 'number') {
    return scores.overall_score <= 1
      ? `${(scores.overall_score * 100).toFixed(0)}%`
      : String(scores.overall_score);
  }
  return String(scores.overall_score);
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
          {label}
        </p>
      </div>
      <p className="text-xl font-extrabold text-[var(--text-primary)] mt-0.5 leading-tight">{value}</p>
    </div>
  );
}

export function VoiceRxDashboard() {
  const [runs, setRuns] = useState<EvaluatorRunHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  useEffect(() => {
    fetchVoiceRxRuns(200)
      .then(setRuns)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    if (runs.length === 0) return null;

    const uniqueEntities = new Set(runs.map((r) => r.entityId).filter(Boolean));
    const successCount = runs.filter((r) => r.status === 'success').length;
    const durations = runs.map((r) => r.durationMs).filter((d): d is number => d != null && d > 0);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    // Evaluator distribution
    const evalCounts: Record<string, number> = {};
    for (const r of runs) {
      const name = r.data.evaluator_name || 'unknown';
      evalCounts[name] = (evalCounts[name] || 0) + 1;
    }

    return {
      totalRuns: runs.length,
      recordingsEvaluated: uniqueEntities.size,
      successRate: runs.length > 0 ? `${((successCount / runs.length) * 100).toFixed(0)}%` : '0%',
      avgDuration: avgDuration > 0 ? formatDuration(avgDuration / 1000) : '--',
      successCount,
      errorCount: runs.length - successCount,
      evalCounts,
    };
  }, [runs]);

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        Failed to load dashboard data: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[0.8rem] text-[var(--text-muted)]">
        Loading...
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-4">
        <h1 className="text-base font-bold text-[var(--text-primary)]">Dashboard</h1>
        <EmptyState
          icon={FlaskConical}
          title="No evaluator runs yet"
          description="Run an evaluator on a recording to see dashboard stats here."
        />
      </div>
    );
  }

  const recentRuns = runs.slice(0, 5);
  const listingMap = new Map(voiceRxListings.map((l) => [l.id, l.title]));

  return (
    <div className="space-y-4">
      <h1 className="text-base font-bold text-[var(--text-primary)]">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Runs" value={stats.totalRuns} icon={Activity} />
        <StatCard label="Recordings Evaluated" value={stats.recordingsEvaluated} icon={Mic} />
        <StatCard label="Success Rate" value={stats.successRate} icon={CheckCircle} />
        <StatCard label="Avg Duration" value={stats.avgDuration} icon={Clock} />
      </div>

      {/* Evaluator distribution */}
      {Object.keys(stats.evalCounts).length > 0 && (
        <div>
          <h2 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            Evaluator Distribution
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.evalCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => {
                const color = TAG_ACCENT_COLORS[hashString(name) % TAG_ACCENT_COLORS.length];
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[var(--text-xs)] font-medium border border-[var(--border-subtle)]"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
                  >
                    {name}
                    <span className="text-[var(--text-muted)] font-normal">{count}</span>
                  </span>
                );
              })}
          </div>
        </div>
      )}

      {/* Status bar */}
      {stats.totalRuns > 0 && (
        <div>
          <h2 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            Status Overview
          </h2>
          <div className="flex rounded overflow-hidden h-4">
            {stats.successCount > 0 && (
              <div
                className="bg-[var(--color-success)] transition-all"
                style={{ width: `${(stats.successCount / stats.totalRuns) * 100}%` }}
                title={`${stats.successCount} success`}
              />
            )}
            {stats.errorCount > 0 && (
              <div
                className="bg-[var(--color-error)] transition-all"
                style={{ width: `${(stats.errorCount / stats.totalRuns) * 100}%` }}
                title={`${stats.errorCount} errors`}
              />
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-[var(--text-xs)] text-[var(--text-muted)]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-success)]" />
              {stats.successCount} success
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-error)]" />
              {stats.errorCount} errors
            </span>
          </div>
        </div>
      )}

      {/* Recent runs */}
      <div>
        <h2 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
          Recent Runs
        </h2>
        <div className="space-y-1.5">
          {recentRuns.map((run) => (
            <Link
              key={run.id}
              to={`/logs?entity_id=${run.id}`}
              className="block bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`shrink-0 h-2 w-2 rounded-full ${
                      run.status === 'success' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
                    }`}
                  />
                  <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                    {run.data.evaluator_name}
                  </span>
                  <span
                    className="text-[var(--text-xs)] font-semibold"
                    style={{ color: scoreColor(run.data.scores) }}
                  >
                    {formatScore(run.data.scores)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[var(--text-xs)] text-[var(--text-muted)]">
                  {run.entityId && (
                    <span className="truncate max-w-[120px]">
                      {listingMap.get(run.entityId) || run.entityId.slice(0, 8)}
                    </span>
                  )}
                  <span>{run.durationMs ? formatDuration(run.durationMs / 1000) : ''}</span>
                  <span>{run.timestamp ? timeAgo(new Date(run.timestamp).toISOString()) : ''}</span>
                </div>
              </div>
            </Link>
          ))}
          {recentRuns.length === 0 && (
            <EmptyState
              icon={FlaskConical}
              title="No runs yet"
              description="Run an evaluator on a recording to see results here."
              compact
            />
          )}
        </div>
      </div>
    </div>
  );
}
