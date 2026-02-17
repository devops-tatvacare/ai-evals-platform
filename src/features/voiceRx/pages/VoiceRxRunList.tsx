import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Trash2, Search } from 'lucide-react';
import { EmptyState, ConfirmDialog } from '@/components/ui';
import { fetchVoiceRxRuns, deleteVoiceRxRun } from '@/services/api/voiceRxHistoryApi';
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

export function VoiceRxRunList() {
  const [runs, setRuns] = useState<EvaluatorRunHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evalFilter, setEvalFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<EvaluatorRunHistory | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  const loadRuns = useCallback(() => {
    setLoading(true);
    fetchVoiceRxRuns(200)
      .then(setRuns)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const evaluatorNames = useMemo(() => {
    const names = new Set(runs.map((r) => r.data.evaluator_name));
    return Array.from(names).sort();
  }, [runs]);

  const filteredRuns = useMemo(() => {
    let result = runs;
    if (evalFilter !== 'all') {
      result = result.filter((r) => r.data.evaluator_name === evalFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }
    return result;
  }, [runs, evalFilter, statusFilter]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteVoiceRxRun(deleteTarget.id);
      setRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  const listingMap = useMemo(
    () => new Map(voiceRxListings.map((l) => [l.id, l.title])),
    [voiceRxListings],
  );

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        Failed to load runs: {error}
      </div>
    );
  }

  return (
    <div className="space-y-3 flex-1 flex flex-col">
      <h1 className="text-base font-bold text-[var(--text-primary)]">All Runs</h1>

      {/* Filters */}
      {!loading && runs.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {['all', ...evaluatorNames].map((name) => {
              const isActive = evalFilter === name;
              return (
                <button
                  key={name}
                  onClick={() => setEvalFilter(name)}
                  className={`px-2.5 py-1 text-[var(--text-xs)] font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                    isActive
                      ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                      : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {name === 'all' ? 'All' : name}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1">
            {['all', 'success', 'error'].map((st) => {
              const isActive = statusFilter === st;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-[var(--text-xs)] font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                    isActive
                      ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                      : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {st === 'all' ? 'Any status' : st}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-[0.8rem] text-[var(--text-muted)]">Loading...</div>
      ) : (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {filteredRuns.map((run) => {
            const color = TAG_ACCENT_COLORS[hashString(run.data.evaluator_name) % TAG_ACCENT_COLORS.length];
            return (
              <div key={run.id} className="group relative">
                <Link
                  to={`/logs?entity_id=${run.id}`}
                  className="block bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  {/* Row 1: status + evaluator name + score */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`shrink-0 h-2 w-2 rounded-full ${
                          run.status === 'success' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
                        }`}
                      />
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-[var(--text-xs)] font-medium"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
                          color,
                        }}
                      >
                        {run.data.evaluator_name}
                      </span>
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: scoreColor(run.data.scores) }}
                      >
                        {formatScore(run.data.scores)}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: ID + listing + type + duration + time */}
                  <div className="flex items-center gap-2 mt-1 text-[var(--text-xs)] text-[var(--text-muted)]">
                    <span className="font-mono">{run.id.slice(0, 8)}</span>
                    <span className="text-[var(--text-tertiary)]">&middot;</span>
                    {run.entityId && (
                      <>
                        <span className="truncate max-w-[160px]">
                          {listingMap.get(run.entityId) || run.entityId.slice(0, 8)}
                        </span>
                        <span className="text-[var(--text-tertiary)]">&middot;</span>
                      </>
                    )}
                    <span>{run.data.evaluator_type}</span>
                    <span className="text-[var(--text-tertiary)]">&middot;</span>
                    <span>{run.durationMs ? formatDuration(run.durationMs / 1000) : '--'}</span>
                    <span className="text-[var(--text-tertiary)]">&middot;</span>
                    <span>{run.timestamp ? timeAgo(new Date(run.timestamp).toISOString()) : ''}</span>
                  </div>
                </Link>

                {/* Delete button on hover */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(run);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                  title="Delete run"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {filteredRuns.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={evalFilter !== 'all' || statusFilter !== 'all' ? Search : FlaskConical}
                title={
                  evalFilter !== 'all' || statusFilter !== 'all'
                    ? 'No matching runs'
                    : 'No evaluator runs yet'
                }
                description={
                  evalFilter !== 'all' || statusFilter !== 'all'
                    ? 'Try changing the filters to see more results.'
                    : 'Run an evaluator on a recording to see results here.'
                }
              />
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Run"
        description={`Delete this evaluator run (${deleteTarget?.data.evaluator_name ?? ''})? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
