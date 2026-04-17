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
import {
  Button,
  ConfirmDialog,
  ModelBadge,
  VisibilityBadge,
  detectProvider,
  FilterButton,
  FilterPanel,
  type FilterFieldConfig,
} from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef, SortState } from '@/components/ui/DataTable';
import { PageShell } from '@/components/ui/PageShell';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { fetchEvalRunsPaged, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { useUIStore } from '@/stores';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { isActiveStatus } from '@/utils/runStatus';
import { scoreColor } from '@/utils/scoreUtils';
import { cn } from '@/utils/cn';
import { usePoll, useTableQueryParams } from '@/hooks';
import { useStableEvalRunUpdate } from '@/features/evalRuns/hooks';
import type { EvalRun } from '@/types';

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
  return { display: String(rounded), color: scoreColor(rounded) };
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

/* ── Filter configuration ────────────────────────────────── */

const FILTER_FIELDS: FilterFieldConfig[] = [
  { key: 'q', label: 'Search', control: 'text', placeholder: 'Search by name or run ID' },
  {
    key: 'status',
    label: 'Status',
    control: 'segmented',
    options: [
      { value: 'running', label: 'Running' },
      { value: 'completed', label: 'Completed' },
      { value: 'completed_with_errors', label: 'Partial' },
      { value: 'failed', label: 'Failed' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
  },
];

const FILTER_KEYS = FILTER_FIELDS.map((f) => f.key);
const TEXT_FILTER_KEYS = ['q'];

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

  const {
    state,
    setPage,
    setPageSize,
    setSort,
    setFilters,
    clearFilters,
    activeFilterCount,
  } = useTableQueryParams({
    defaultPageSize: 25,
    filterKeys: FILTER_KEYS,
    textFilterKeys: TEXT_FILTER_KEYS,
    defaultSort: { key: 'created_at', order: 'desc' },
  });

  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const isInitialLoad = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const stableSetRuns = useStableEvalRunUpdate(setRuns);
  const openModal = useUIStore((s) => s.openModal);

  const qValue = typeof state.filters.q === 'string' ? state.filters.q : '';
  const statusValue =
    typeof state.filters.status === 'string' && state.filters.status.length > 0
      ? state.filters.status
      : undefined;

  const loadRuns = useCallback((): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isInitialLoad.current) setIsLoading(true);

    return fetchEvalRunsPaged({
      app_id: 'inside-sales',
      page: state.page,
      page_size: state.pageSize,
      sort: state.sort,
      order: state.order,
      status: statusValue,
      q: qValue || undefined,
      signal: controller.signal,
    })
      .then((res) => {
        stableSetRuns(res.items);
        setTotalItems(res.totalItems);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        notificationService.error(e.message || 'Failed to load runs');
      })
      .finally(() => {
        setIsLoading(false);
        isInitialLoad.current = false;
      });
  }, [state.page, state.pageSize, state.sort, state.order, statusValue, qValue, stableSetRuns]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const hasActive = runs.some((r) => isActiveStatus(r.status));
  usePoll({ fn: async () => { await loadRuns(); return true; }, enabled: hasActive, intervalMs: 5000 });

  /* ── Build table rows ──────────────────────────────────── */

  const tableData = useMemo((): TableRow[] =>
    runs.map((run): TableRow => {
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
  [runs]);

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
      sortable: true,
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
      key: 'duration_ms',
      header: 'DURATION',
      width: 'w-24',
      sortable: true,
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
      key: 'created_at',
      header: 'DATE',
      width: 'w-24',
      sortable: true,
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

  /* ── Render ────────────────────────────────────────────── */

  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  const sortState: SortState | undefined = state.sort && state.order
    ? { key: state.sort, order: state.order }
    : undefined;

  const toolbar = (
    <div className="flex items-center gap-2">
      <FilterButton activeCount={activeFilterCount} onClick={() => setFilterPanelOpen(true)} />
    </div>
  );

  return (
    <PageShell
      title="Runs"
      headerActions={
        <Button size="sm" onClick={() => openModal('insideSalesEval')}>
          <Plus className="h-3.5 w-3.5" />
          New Run
        </Button>
      }
      filterSlot={toolbar}
    >
      <DataTable
        columns={columns}
        data={tableData}
        keyExtractor={(row) => row.id}
        onRowClick={handleRowClick}
        loading={isLoading}
        emptyIcon={activeFilterCount > 0 ? Search : ListChecks}
        emptyTitle={activeFilterCount > 0 ? 'No matching runs' : 'No evaluation runs yet'}
        emptyDescription={
          activeFilterCount > 0
            ? 'Try changing the filters or search query.'
            : 'Start a new evaluation from the wizard.'
        }
        sortState={sortState}
        onSortChange={setSort}
        pagination={{
          page: state.page,
          totalPages,
          pageSize: state.pageSize,
          totalItems,
          showCount: true,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
        }}
      />

      <FilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        fields={FILTER_FIELDS}
        values={state.filters}
        onChange={setFilters}
        onClear={clearFilters}
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
