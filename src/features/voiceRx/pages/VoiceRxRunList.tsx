import { useState, useEffect, useCallback, useMemo } from 'react';
import { FlaskConical, Search } from 'lucide-react';
import { EmptyState, ConfirmDialog } from '@/components/ui';
import { RunRowCard } from '@/features/evalRuns/components';
import { fetchEvalRuns, deleteEvalRun } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { useListingsStore } from '@/stores';
import { TAG_ACCENT_COLORS } from '@/utils/statusColors';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import type { EvalRun } from '@/types';

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Extract a display name from an EvalRun */
function getEvalRunName(run: EvalRun): string {
  const summary = run.summary as Record<string, unknown> | undefined;
  const config = run.config as Record<string, unknown> | undefined;
  return (
    (summary?.evaluator_name as string) ??
    (config?.evaluator_name as string) ??
    run.evalType ??
    'Unknown'
  );
}

/**
 * Find the first numeric value in run.summary that looks like a score (0-1 range or 0-100).
 * Returns a formatted string and the raw value for color computation.
 */
function extractMainScore(run: EvalRun): { display: string; raw: number | null } {
  const summary = run.summary as Record<string, unknown> | undefined;
  if (!summary) return { display: '--', raw: null };

  // Check for common score field names first
  const scoreKeys = ['overall_score', 'score', 'accuracy', 'pass_rate', 'factual_integrity_score'];
  for (const key of scoreKeys) {
    const val = summary[key];
    if (typeof val === 'number') {
      return {
        display: val <= 1 ? `${(val * 100).toFixed(0)}%` : String(val),
        raw: val,
      };
    }
    if (typeof val === 'boolean') {
      return { display: val ? 'Pass' : 'Fail', raw: val ? 1 : 0 };
    }
    if (typeof val === 'string') {
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) {
        return {
          display: parsed <= 1 ? `${(parsed * 100).toFixed(0)}%` : val,
          raw: parsed,
        };
      }
    }
  }

  // Fallback: scan all summary fields for a numeric value in 0-1 range
  for (const [, val] of Object.entries(summary)) {
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      return { display: `${(val * 100).toFixed(0)}%`, raw: val };
    }
  }

  return { display: '--', raw: null };
}

function scoreColor(raw: number | null): string {
  if (raw == null) return 'var(--text-muted)';
  // Normalize to 0-1 range
  const val = raw > 1 ? raw / 100 : raw;
  if (val >= 0.7) return 'var(--color-success)';
  if (val >= 0.4) return 'var(--color-warning)';
  return 'var(--color-error)';
}

/** Map new EvalRun status to the display status values */
function mapStatusForDisplay(status: EvalRun['status']): string {
  switch (status) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'completed_with_errors': return 'completed_with_errors';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'cancelled': return 'cancelled';
    default: return status;
  }
}

/** Get eval type label for display */
function getEvalTypeLabel(run: EvalRun): string {
  const config = run.config as Record<string, unknown> | undefined;
  return (config?.evaluator_type as string) ?? run.evalType ?? '--';
}

export function VoiceRxRunList() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evalFilter, setEvalFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<EvalRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  const loadRuns = useCallback(() => {
    setLoading(true);
    fetchEvalRuns({ app_id: 'voice-rx', limit: 200 })
      .then(setRuns)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Light polling: re-fetch when any visible run is still running
  const hasRunning = useMemo(
    () => runs.some((r) => r.status === 'running'),
    [runs],
  );

  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => loadRuns(), 5000);
    return () => clearInterval(interval);
  }, [hasRunning, loadRuns]);

  const evaluatorNames = useMemo(() => {
    const names = new Set(runs.map((r) => getEvalRunName(r)));
    return Array.from(names).sort();
  }, [runs]);

  const filteredRuns = useMemo(() => {
    let result = runs;
    if (evalFilter !== 'all') {
      result = result.filter((r) => getEvalRunName(r) === evalFilter);
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'success') {
        result = result.filter((r) => r.status === 'completed');
      } else if (statusFilter === 'error') {
        result = result.filter((r) => r.status === 'failed' || r.status === 'completed_with_errors');
      } else {
        result = result.filter((r) => r.status === statusFilter);
      }
    }
    return result;
  }, [runs, evalFilter, statusFilter]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed', "Delete failed");
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
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
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
            {['all', ...evaluatorNames].map((name) => (
              <button
                key={name}
                onClick={() => setEvalFilter(name)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  evalFilter === name
                    ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                    : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {name === 'all' ? 'All' : name}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {['all', 'success', 'error'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  statusFilter === st
                    ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                    : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {st === 'all' ? 'Any status' : st}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {filteredRuns.map((run) => {
            const name = getEvalRunName(run);
            const color = TAG_ACCENT_COLORS[hashString(name) % TAG_ACCENT_COLORS.length];
            const { display: scoreDisplay, raw: scoreRaw } = extractMainScore(run);
            return (
              <RunRowCard
                key={run.id}
                to={`${routes.voiceRx.logs}?entity_id=${run.id}`}
                status={mapStatusForDisplay(run.status)}
                title={name}
                titleColor={color}
                score={scoreDisplay}
                scoreColor={scoreColor(scoreRaw)}
                id={run.id.slice(0, 8)}
                metadata={[
                  ...(run.listingId
                    ? [{ text: listingMap.get(run.listingId) || run.listingId.slice(0, 8) }]
                    : []),
                  { text: getEvalTypeLabel(run) },
                  { text: run.durationMs ? formatDuration(run.durationMs / 1000) : '--' },
                ]}
                timeAgo={run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : ''}
                onDelete={() => setDeleteTarget(run)}
              />
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
        description={`Delete this evaluator run (${deleteTarget ? getEvalRunName(deleteTarget) : ''})? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
