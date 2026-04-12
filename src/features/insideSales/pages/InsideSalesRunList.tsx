import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  ListChecks,
  Clock,
  MoreVertical,
  Trash2,
  Square,
} from 'lucide-react';
import { Button, ConfirmDialog, ModelBadge, VisibilityBadge, detectProvider } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { PageShell } from '@/components/ui/PageShell';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { fetchEvalRuns, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { useUIStore } from '@/stores';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { isActiveStatus } from '@/utils/runStatus';
import { scoreColor } from '@/utils/scoreUtils';
import { cn } from '@/utils/cn';
import { usePoll } from '@/hooks';
import { useStableEvalRunUpdate, useDebouncedValue } from '@/features/evalRuns/hooks';
import type { EvalRun } from '@/types';

const PAGE_SIZE = 15;

/* ── Helpers ─────────────────────────────────────────────── */

function getRunName(run: EvalRun): string {
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
}

function getScore(run: EvalRun): { display: string; color: string } {
  const summary = run.summary as Record<string, unknown> | undefined;
  const score = summary?.overall_score as number | undefined;
  if (typeof score !== 'number') return { display: '--', color: 'var(--text-muted)' };
  const rounded = Math.round(score);
  const color = scoreColor(rounded);
  return { display: String(rounded), color };
}

function getProgress(run: EvalRun): { current: number; total: number } | undefined {
  const summary = run.summary as Record<string, unknown> | undefined;
  const evaluated = summary?.evaluated as number | undefined;
  const total = summary?.total as number | undefined;
  if (typeof evaluated === 'number' && typeof total === 'number') return { current: evaluated, total };
  return undefined;
}

/* ── Status styles ───────────────────────────────────────── */

const STATUS_STYLES: Record<string, { color: string; dot: string; label: string; pulseClass?: string }> = {
  completed:             { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Completed' },
  completed_with_errors: { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Partial' },
  cancelled:             { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Cancelled' },
  failed:                { color: 'var(--color-error)',   dot: 'var(--color-error)',   label: 'Failed' },
  running:               { color: 'var(--color-info)',    dot: 'var(--color-info)',    label: 'Running', pulseClass: 'animate-pulse' },
  pending:               { color: 'var(--text-muted)',    dot: 'var(--text-muted)',    label: 'Pending' },
};

/* ── Filter chip config ─────────────────────────────────── */

const STATUS_FILTERS: Array<{ key: string; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running', dotColor: 'var(--color-info)' },
  { key: 'completed', label: 'Completed', dotColor: 'var(--color-success)' },
  { key: 'partial', label: 'Partial', dotColor: 'var(--color-warning)' },
  { key: 'failed', label: 'Failed', dotColor: 'var(--color-error)' },
  { key: 'cancelled', label: 'Cancelled', dotColor: 'var(--color-warning)' },
];

/* ── Table row type ──────────────────────────────────────── */

interface TableRow {
  id: string;
  title: string;
  status: string;
  score: string;
  scoreColor: string;
  visibility?: 'private' | 'shared';
  ownerName?: string;
  duration?: string;
  modelName?: string;
  provider?: string;
  dateStr: string;
  isRunning: boolean;
  jobId?: string;
  progress?: { current: number; total: number };
  hasHumanReview: boolean;
  run: EvalRun;
}

/* ── Component ───────────────────────────────────────────── */

export function InsideSalesRunList() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const isInitialLoad = useRef(true);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const stableSetRuns = useStableEvalRunUpdate(setRuns);
  const openModal = useUIStore((s) => s.openModal);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [statusFilter, debouncedSearch]);

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

  /* ── Filtered runs ─────────────────────────────────────── */

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
        const name = getRunName(r);
        return name.toLowerCase().includes(q) || r.id.includes(q);
      });
    }

    return result;
  }, [runs, statusFilter, debouncedSearch]);

  /* ── Build table rows ──────────────────────────────────── */

  const tableData = useMemo((): TableRow[] =>
    filteredRuns.map((run): TableRow => {
      const { display: score, color: sc } = getScore(run);
      return {
        id: run.id,
        title: getRunName(run),
        status: run.status === 'completed_with_errors' ? 'completed_with_errors' : run.status,
        score,
        scoreColor: sc,
        visibility: run.visibility,
        ownerName: run.ownerName ?? undefined,
        duration: run.durationMs ? formatDuration(Math.round(run.durationMs / 1000)) : '--',
        modelName: run.llmModel || undefined,
        provider: run.llmProvider || undefined,
        dateStr: run.startedAt ? timeAgo(run.startedAt) : '',
        isRunning: isActiveStatus(run.status),
        jobId: run.jobId || undefined,
        progress: getProgress(run),
        hasHumanReview: !!run.latestReviewId,
        run,
      };
    }),
  [filteredRuns]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(tableData.length / PAGE_SIZE));
  const pagedData = tableData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /* ── Handlers ──────────────────────────────────────────── */

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

  const handleCancel = useCallback(async (jobId: string) => {
    try {
      await jobsApi.cancel(jobId);
      notificationService.success('Run cancelled');
      loadRuns();
    } catch {
      notificationService.error('Cancel failed');
    }
  }, [loadRuns]);

  const handleRowClick = useCallback((row: TableRow) => {
    navigate(routes.insideSales.runDetail(row.id));
  }, [navigate]);

  /* ── Column definitions ────────────────────────────────── */

  const columns = useMemo((): ColumnDef<TableRow>[] => [
    {
      key: 'name',
      header: 'NAME',
      width: 'min-w-[200px]',
      render: (row) => (
        <div>
          <span className="font-semibold text-sm text-[var(--text-primary)]">{row.title}</span>
          <br />
          <span className="font-mono text-[11px] text-[var(--text-muted)]">{row.id.slice(0, 8)}</span>
        </div>
      ),
    },
    {
      key: 'score',
      header: 'SCORE',
      width: 'w-20',
      render: (row) => (
        <span className="text-sm font-semibold" style={{ color: row.scoreColor }}>
          {row.score}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'STATUS',
      width: 'w-[140px]',
      render: (row) => {
        const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
        const progress = row.progress;
        const label = row.isRunning && progress
          ? `Running (${progress.current}/${progress.total})`
          : style.label;
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap"
            style={{ borderColor: style.color, color: style.color }}
          >
            <span
              className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', style.pulseClass)}
              style={{ backgroundColor: style.dot }}
            />
            {label}
          </span>
        );
      },
    },
    {
      key: 'visibility',
      header: 'VISIBILITY',
      width: 'w-24',
      render: (row) => row.visibility
        ? <VisibilityBadge visibility={row.visibility} compact />
        : <span className="text-[var(--text-muted)]">--</span>,
    },
    {
      key: 'owner',
      header: 'OWNER',
      width: 'w-28',
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)] truncate block max-w-[100px]">
          {row.ownerName ?? '--'}
        </span>
      ),
    },
    {
      key: 'duration',
      header: 'DURATION',
      width: 'w-24',
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">{row.duration ?? '--'}</span>
      ),
    },
    {
      key: 'model',
      header: 'MODEL',
      width: 'w-[140px]',
      render: (row) => row.modelName ? (
        <ModelBadge
          modelName={row.modelName}
          provider={row.provider ? detectProvider(row.provider) : undefined}
          variant="inline"
        />
      ) : <span className="text-[var(--text-muted)]">--</span>,
    },
    {
      key: 'date',
      header: 'DATE',
      width: 'w-24',
      render: (row) => (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] whitespace-nowrap">
          <Clock className="h-3 w-3" />
          {row.dateStr}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 'w-16',
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Popover
            open={menuOpenId === row.id}
            onOpenChange={(open) => setMenuOpenId(open ? row.id : null)}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              className="w-fit min-w-[140px] rounded-[8px] bg-[var(--bg-elevated)] py-1"
            >
              {row.isRunning && row.jobId && (
                <PermissionGate action="evaluation:cancel">
                  <button
                    type="button"
                    onClick={() => {
                      handleCancel(row.jobId!);
                      setMenuOpenId(null);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-error)] hover:bg-[var(--interactive-secondary)]"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Cancel
                  </button>
                </PermissionGate>
              )}
              <PermissionGate action="evaluation:delete">
                <button
                  type="button"
                  disabled={row.isRunning}
                  onClick={() => {
                    setDeleteTarget({ id: row.id, label: row.title });
                    setMenuOpenId(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-error)] hover:bg-[var(--interactive-secondary)] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </PermissionGate>
            </PopoverContent>
          </Popover>
        </div>
      ),
    },
  ], [menuOpenId, handleCancel]);

  /* ── Filter slot ───────────────────────────────────────── */

  const hasActiveFilters = statusFilter !== 'all' || debouncedSearch.length > 0;

  const filterSlot = (
    <div className="space-y-2">
      {/* Search input */}
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

      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Status</span>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
              statusFilter === f.key
                ? 'bg-[var(--surface-info)] text-[var(--color-info)] border border-[var(--border-info)]'
                : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
            )}
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
  );

  /* ── Render ────────────────────────────────────────────── */

  return (
    <PageShell
      title="Runs"
      headerActions={
        <Button size="sm" onClick={() => openModal('insideSalesEval')}>
          <Plus className="h-3.5 w-3.5" />
          New Run
        </Button>
      }
      filterSlot={filterSlot}
    >
      <DataTable
        columns={columns}
        data={pagedData}
        keyExtractor={(row) => row.id}
        onRowClick={handleRowClick}
        loading={isLoading}
        emptyIcon={hasActiveFilters ? Search : ListChecks}
        emptyTitle={hasActiveFilters ? 'No matching runs' : 'No evaluation runs yet'}
        emptyDescription={
          hasActiveFilters
            ? 'Try changing the filters or search query.'
            : 'Start a new evaluation from the wizard.'
        }
        pagination={{ page: page + 1, totalPages, onPageChange: (p) => setPage(p - 1) }}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Run"
        description={`Delete run "${deleteTarget?.label ?? ''}"? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        onConfirm={handleDeleteConfirmed}
        onClose={() => setDeleteTarget(null)}
        isLoading={isDeleting}
      />
    </PageShell>
  );
}
