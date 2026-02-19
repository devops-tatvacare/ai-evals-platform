import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FlaskConical, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState, ConfirmDialog } from '@/components/ui';
import { RunRowCard } from '@/features/evalRuns/components';
import { fetchEvalRuns, deleteEvalRun } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { useListingsStore } from '@/stores';
import { TAG_ACCENT_COLORS } from '@/utils/statusColors';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { useStableEvalRunUpdate, useDebouncedValue } from '@/features/evalRuns/hooks';
import type { RunType } from '@/features/evalRuns/types';
import { RUN_TYPE_CONFIG } from '@/features/evalRuns/types';
import type { EvalRun } from '@/types';

const PAGE_SIZE = 15;

/* ── Helpers ─────────────────────────────────────────────── */

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

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

function extractMainScore(run: EvalRun): { display: string; raw: number | null } {
  const summary = run.summary as Record<string, unknown> | undefined;
  if (!summary) return { display: '--', raw: null };

  const scoreKeys = ['overall_score', 'overall_accuracy', 'score', 'accuracy', 'pass_rate', 'factual_integrity_score'];
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

  for (const [, val] of Object.entries(summary)) {
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      return { display: `${(val * 100).toFixed(0)}%`, raw: val };
    }
  }

  return { display: '--', raw: null };
}

function scoreColor(raw: number | null): string {
  if (raw == null) return 'var(--text-muted)';
  const val = raw > 1 ? raw / 100 : raw;
  if (val >= 0.7) return 'var(--color-success)';
  if (val >= 0.4) return 'var(--color-warning)';
  return 'var(--color-error)';
}

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

function getEvalTypeLabel(run: EvalRun): string {
  const config = run.config as Record<string, unknown> | undefined;
  return (config?.evaluator_type as string) ?? run.evalType ?? '--';
}

function mapEvalTypeToRunType(evalType: string): RunType {
  if (evalType === 'batch_thread' || evalType === 'batch_adversarial') return 'batch';
  if (evalType === 'custom') return 'custom';
  return 'thread';
}

/* ── Filter chip configs ─────────────────────────────────── */

const TYPE_FILTERS: Array<{ key: RunType | 'all'; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'batch', label: 'Batch', dotColor: RUN_TYPE_CONFIG.batch.color },
  { key: 'thread', label: 'Thread', dotColor: RUN_TYPE_CONFIG.thread.color },
  { key: 'custom', label: 'Custom', dotColor: RUN_TYPE_CONFIG.custom.color },
];

const STATUS_FILTERS: Array<{ key: string; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed', dotColor: 'var(--color-success)' },
  { key: 'partial', label: 'Partial', dotColor: 'var(--color-warning)' },
  { key: 'cancelled', label: 'Cancelled', dotColor: 'var(--color-warning)' },
  { key: 'failed', label: 'Failed', dotColor: 'var(--color-error)' },
  { key: 'running', label: 'Running', dotColor: 'var(--color-info)' },
];

/* ── Component ───────────────────────────────────────────── */

export function VoiceRxRunList() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<RunType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<EvalRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  // Shimmer fix
  const isInitialLoad = useRef(true);
  const stableSetRuns = useStableEvalRunUpdate(setRuns);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [typeFilter, statusFilter, debouncedSearch]);

  const loadRuns = useCallback(() => {
    if (isInitialLoad.current) {
      setLoading(true);
    }
    fetchEvalRuns({ app_id: 'voice-rx', limit: 200 })
      .then(stableSetRuns)
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  }, [stableSetRuns]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Light polling
  const hasRunning = useMemo(
    () => runs.some((r) => r.status === 'running'),
    [runs],
  );

  useEffect(() => {
    if (!hasRunning) return;
    const interval = setInterval(() => loadRuns(), 5000);
    return () => clearInterval(interval);
  }, [hasRunning, loadRuns]);

  /* ── Filtering ─────────────────────────────────────────── */

  const filteredRuns = useMemo(() => {
    let result = runs;

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((r) => mapEvalTypeToRunType(r.evalType) === typeFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((r) => {
        const s = mapStatusForDisplay(r.status);
        if (statusFilter === 'partial') return s === 'completed_with_errors';
        if (statusFilter === 'failed') return s === 'failed';
        if (statusFilter === 'completed') return s === 'completed';
        if (statusFilter === 'cancelled') return s === 'cancelled';
        if (statusFilter === 'running') return s === 'running';
        return true;
      });
    }

    // Search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((r) =>
        getEvalRunName(r).toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
      );
    }

    return result;
  }, [runs, typeFilter, statusFilter, debouncedSearch]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE));
  const pagedRuns = filteredRuns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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

  const hasActiveFilters = typeFilter !== 'all' || statusFilter !== 'all' || debouncedSearch.length > 0;

  return (
    <div className="space-y-3 flex-1 flex flex-col">
      <h1 className="text-base font-bold text-[var(--text-primary)]">All Runs</h1>

      {/* Search + Filter bar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or ID..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Type</span>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                typeFilter === f.key
                  ? 'bg-[var(--surface-info)] text-[var(--color-info)] border border-[var(--border-info)]'
                  : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {f.dotColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: f.dotColor }}
                />
              )}
              {f.label}
            </button>
          ))}

          <span className="text-[var(--border-default)] mx-1">|</span>

          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Status</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                statusFilter === f.key
                  ? 'bg-[var(--surface-info)] text-[var(--color-info)] border border-[var(--border-info)]'
                  : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {f.dotColor && (
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: f.dotColor }}
                />
              )}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {pagedRuns.map((run) => {
            const name = getEvalRunName(run);
            const color = TAG_ACCENT_COLORS[hashString(name) % TAG_ACCENT_COLORS.length];
            const { display: scoreDisplay, raw: scoreRaw } = extractMainScore(run);
            return (
              <RunRowCard
                key={run.id}
                to={routes.voiceRx.runDetail(run.id)}
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
                runType={mapEvalTypeToRunType(run.evalType)}
                modelName={run.llmModel || undefined}
                provider={run.llmProvider || undefined}
              />
            );
          })}
          {pagedRuns.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={hasActiveFilters ? Search : FlaskConical}
                title={hasActiveFilters ? 'No matching runs' : 'No evaluator runs yet'}
                description={hasActiveFilters
                  ? 'Try changing the filters or search query.'
                  : 'Run an evaluator on a recording to see results here.'}
              />
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-1 pb-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`min-w-[28px] h-7 px-1.5 text-xs font-medium rounded transition-colors ${
                page === i
                  ? 'bg-[var(--interactive-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
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
