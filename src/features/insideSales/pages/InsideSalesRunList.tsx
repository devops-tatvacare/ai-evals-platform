import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, ListChecks, Plus } from 'lucide-react';
import { Button, EmptyState, ConfirmDialog } from '@/components/ui';
import { RunRowCard } from '@/features/evalRuns/components';
import { fetchEvalRuns, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { useUIStore } from '@/stores';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { isActiveStatus } from '@/utils/runStatus';
import { scoreColor } from '@/utils/scoreUtils';
import { cn } from '@/utils';
import { usePoll } from '@/hooks';
import { useStableEvalRunUpdate, useDebouncedValue } from '@/features/evalRuns/hooks';
import type { EvalRun } from '@/types';

const STATUS_FILTERS: Array<{ key: string; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running', dotColor: 'var(--color-info)' },
  { key: 'completed', label: 'Completed', dotColor: 'var(--color-success)' },
  { key: 'partial', label: 'Partial', dotColor: 'var(--color-warning)' },
  { key: 'failed', label: 'Failed', dotColor: 'var(--color-error)' },
  { key: 'cancelled', label: 'Cancelled', dotColor: 'var(--color-warning)' },
];

export function InsideSalesRunList() {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<EvalRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const isInitialLoad = useRef(true);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const stableSetRuns = useStableEvalRunUpdate(setRuns);
  const openModal = useUIStore((s) => s.openModal);

  const loadRuns = useCallback((): Promise<void> => {
    if (isInitialLoad.current) setIsLoading(true);
    return fetchEvalRuns({ app_id: 'inside-sales' })
      .then(stableSetRuns)
      .catch(() => {})
      .finally(() => {
        setIsLoading(false);
        isInitialLoad.current = false;
      });
  }, [stableSetRuns]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Poll if any run is active
  const hasActive = runs.some((r) => isActiveStatus(r.status));
  usePoll({ fn: async () => { await loadRuns(); return true; }, enabled: hasActive, intervalMs: 5000 });

  const handleDeleteConfirmed = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      notificationService.success('Run deleted');
      loadRuns();
    } catch {
      notificationService.error('Delete failed');
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, loadRuns]);

  const handleCancel = useCallback(async (run: EvalRun) => {
    if (!run.jobId) return;
    try {
      await jobsApi.cancel(run.jobId);
      notificationService.success('Run cancelled');
      loadRuns();
    } catch {
      notificationService.error('Cancel failed');
    }
  }, [loadRuns]);

  const filteredRuns = useMemo(() => {
    let result = runs;

    if (statusFilter !== 'all') {
      result = result.filter((r) => {
        if (statusFilter === 'partial') return r.status === 'completed_with_errors';
        return r.status === statusFilter;
      });
    }

    const q = debouncedSearch.toLowerCase().trim();
    if (q) {
      result = result.filter((r) => {
        const config = r.config as Record<string, unknown> | undefined;
        const name = (config?.run_name as string) || r.evalType || '';
        return name.toLowerCase().includes(q) || r.id.includes(q);
      });
    }

    return result;
  }, [runs, statusFilter, debouncedSearch]);

  const getRunName = (run: EvalRun): string => {
    const config = run.config as Record<string, unknown> | undefined;
    const summary = run.summary as Record<string, unknown> | undefined;
    const meta = run.batchMetadata as Record<string, unknown> | undefined;
    return (
      (config?.run_name as string) ??
      (meta?.run_name as string) ??
      (summary?.evaluator_name as string) ??
      (config?.evaluator_name as string) ??
      'Call Quality Evaluation'
    );
  };

  const getScore = (run: EvalRun): { display: string; color: string } => {
    const summary = run.summary as Record<string, unknown> | undefined;
    const score = summary?.overall_score as number | undefined;
    if (typeof score !== 'number') return { display: '--', color: 'var(--text-muted)' };
    const rounded = Math.round(score);
    const color = scoreColor(rounded);
    return { display: String(rounded), color };
  };

  const getProgress = (run: EvalRun): { current: number; total: number } | undefined => {
    const summary = run.summary as Record<string, unknown> | undefined;
    const evaluated = summary?.evaluated as number | undefined;
    const total = summary?.total as number | undefined;
    if (typeof evaluated === 'number' && typeof total === 'number') return { current: evaluated, total };
    return undefined;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 pb-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Runs</h1>
        <Button size="sm" onClick={() => openModal('insideSalesEval')}>
          <Plus className="h-3.5 w-3.5" />
          New Run
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search runs..."
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
        />
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
              statusFilter === f.key
                ? 'border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/10 text-[var(--text-brand)]'
                : 'border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-brand)] hover:text-[var(--text-primary)]'
            )}
          >
            {f.dotColor && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: f.dotColor }}
              />
            )}
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--color-brand-accent)]" />
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={ListChecks}
            title={searchQuery ? 'No matching runs' : 'No evaluation runs yet'}
            description={searchQuery ? 'Try a different search.' : 'Start a new evaluation from the wizard.'}
            action={!searchQuery ? { label: 'New Run', onClick: () => openModal('insideSalesEval') } : undefined}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-1.5">
          {filteredRuns.map((run) => {
            const { display: scoreDisplay, color: scoreColorValue } = getScore(run);
            const active = isActiveStatus(run.status);
            return (
              <RunRowCard
                key={run.id}
                to={routes.insideSales.runDetail(run.id)}
                status={run.status}
                title={getRunName(run)}
                score={scoreDisplay}
                scoreColor={scoreColorValue}
                id={run.id}
                timeAgo={run.startedAt ? timeAgo(run.startedAt) : '—'}
                isRunning={active}
                onCancel={active ? () => handleCancel(run) : undefined}
                onDelete={() => setDeleteTarget(run)}
                modelName={run.llmModel || undefined}
                provider={run.llmProvider || undefined}
                progress={getProgress(run)}
                visibility={run.visibility}
                ownerName={run.ownerName ?? undefined}
                metadata={[
                  ...(run.durationMs ? [{ text: formatDuration(Math.round(run.durationMs / 1000)) }] : []),
                ]}
              />
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete run"
        description={`Delete "${deleteTarget ? getRunName(deleteTarget) : ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onClose={() => setDeleteTarget(null)}
        isLoading={isDeleting}
      />
    </div>
  );
}
