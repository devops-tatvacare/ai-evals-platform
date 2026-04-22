import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePoll, useTableQueryParams } from '@/hooks';
import {
  FlaskConical,
  Search,
  Loader2,
  Clock,
  MoreVertical,
  Trash2,
  Square,
} from 'lucide-react';
import type { EvalRun } from '@/types';
import { fetchEvalRunsPaged, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import {
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
import { PageSurface } from '@/components/ui/PageSurface';
import type { LucideIcon } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { isActiveStatus } from '@/utils/runStatus';
import { inferAppIdFromPath, runDetailForApp, apiLogsForApp } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { useStableEvalRunUpdate } from '../hooks';
import { useJobTrackerStore } from '@/stores';
import { cn } from '@/utils/cn';
import type { RunType } from '../types';
import { RUN_TYPE_CONFIG } from '../types';

/* ── Helpers ─────────────────────────────────────────────── */

function getRunName(run: EvalRun): string {
  const s = run.summary as Record<string, unknown> | undefined;
  const c = run.config as Record<string, unknown> | undefined;
  const batch = (run as unknown as { batchMetadata?: Record<string, unknown> }).batchMetadata;
  return (
    (s?.evaluator_name as string) ??
    (c?.evaluator_name as string) ??
    (batch?.name as string) ??
    run.evalType ??
    'Unknown'
  );
}

function formatScoreValue(v: number): { value: string; color: string } {
  const normalized = v > 1 ? v / 100 : v;
  return {
    value: v > 1 ? `${v.toFixed(0)}` : `${(v * 100).toFixed(0)}%`,
    color:
      normalized >= 0.7 ? 'var(--color-success)' :
      normalized >= 0.4 ? 'var(--color-warning)' :
      'var(--color-error)',
  };
}

function getRunScore(run: EvalRun): { value: string; color: string; badge?: string } {
  const s = run.summary as Record<string, unknown> | undefined;
  if (!s) return { value: '--', color: 'var(--text-muted)' };

  const evaluators = s.evaluators as Array<{ average_score?: number }> | undefined;
  const avg = s.average_score;
  if (typeof avg === 'number' && Number.isFinite(avg)) {
    const formatted = formatScoreValue(avg);
    return evaluators && evaluators.length > 1
      ? { ...formatted, badge: `avg of ${evaluators.length}` }
      : formatted;
  }

  for (const [, v] of Object.entries(s)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) {
      return formatScoreValue(v);
    }
  }
  return { value: '--', color: 'var(--text-muted)' };
}

function mapEvalRunStatus(status: EvalRun['status']): string {
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

function deriveRunTypeFromEvalType(evalType: string): RunType {
  if (evalType === 'batch_thread') return 'batch';
  if (evalType === 'batch_adversarial') return 'adversarial';
  if (evalType === 'custom') return 'custom';
  if (evalType === 'full_evaluation') return 'evaluation';
  return 'thread';
}

function jobTypeToRunType(jobType: string): RunType {
  if (jobType.includes('adversarial')) return 'adversarial';
  if (jobType.includes('batch')) return 'batch';
  return 'custom';
}

/* ── Status styles ───────────────────────────────────────── */

const STATUS_STYLES: Record<string, { color: string; dot: string; label: string; pulseClass?: string }> = {
  completed:            { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Completed' },
  success:              { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Success' },
  completed_with_errors: { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Partial' },
  partial:              { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Partial' },
  cancelled:            { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Cancelled' },
  failed:               { color: 'var(--color-error)',   dot: 'var(--color-error)',   label: 'Failed' },
  error:                { color: 'var(--color-error)',   dot: 'var(--color-error)',   label: 'Error' },
  running:              { color: 'var(--color-info)',    dot: 'var(--color-info)',    label: 'Running', pulseClass: 'animate-pulse' },
  pending:              { color: 'var(--text-muted)',    dot: 'var(--text-muted)',    label: 'Pending' },
  queued:               { color: 'var(--color-info)',    dot: 'var(--color-info)',    label: 'Queued', pulseClass: 'animate-pulse' },
};

/* ── Unified table row type ──────────────────────────────── */

interface TableRow {
  id: string;
  kind: 'run' | 'queued';
  runType: RunType;
  title: string;
  status: string;
  score: string;
  scoreColor: string;
  scoreBadge?: string;
  visibility?: 'private' | 'shared';
  ownerName?: string;
  items?: string;
  duration?: string;
  modelName?: string;
  provider?: string;
  dateStr: string;
  isRunning: boolean;
  jobId?: string;
  hasHumanReview: boolean;
  run?: EvalRun;
}

/* ── Filter configuration ────────────────────────────────── */

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'q',
    label: 'Search',
    control: 'text',
    placeholder: 'Search by name or run ID',
  },
  {
    key: 'run_type',
    label: 'Type',
    control: 'segmented',
    options: [
      { value: 'batch', label: 'Batch' },
      { value: 'adversarial', label: 'Adversarial' },
      { value: 'thread', label: 'Thread' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    control: 'segmented',
    options: [
      { value: 'completed', label: 'Completed' },
      { value: 'completed_with_errors', label: 'Partial' },
      { value: 'cancelled', label: 'Cancelled' },
      { value: 'failed', label: 'Failed' },
      { value: 'running', label: 'Running' },
    ],
  },
];

const FILTER_KEYS = FILTER_FIELDS.map((f) => f.key);
const TEXT_FILTER_KEYS = ['q'];

/* ── Component ───────────────────────────────────────────── */

interface RunListSurface {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

interface RunListProps {
  /**
   * When provided, the page renders inside the unified PageSurface shell with
   * the given icon/title/actions. When omitted, the page falls back to the
   * legacy PageShell layout (other apps). Used by the Kaira prototype.
   */
  surface?: RunListSurface;
}

export default function RunList({ surface }: RunListProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();

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

  const [items, setItems] = useState<EvalRun[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const isInitialLoad = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const stableSetItems = useStableEvalRunUpdate(setItems);

  const appId = inferAppIdFromPath(location.pathname) ?? 'kaira-bot';

  const qValue = typeof state.filters.q === 'string' ? state.filters.q : '';
  const runTypeValue =
    typeof state.filters.run_type === 'string' && state.filters.run_type.length > 0
      ? (state.filters.run_type as 'batch' | 'adversarial' | 'thread' | 'custom' | 'evaluation')
      : undefined;
  const statusValue =
    typeof state.filters.status === 'string' && state.filters.status.length > 0
      ? state.filters.status
      : undefined;

  const loadRuns = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isInitialLoad.current) setLoading(true);
    setError('');

    fetchEvalRunsPaged({
      app_id: appId,
      page: state.page,
      page_size: state.pageSize,
      sort: state.sort,
      order: state.order,
      run_type: runTypeValue,
      status: statusValue,
      q: qValue || undefined,
      signal: controller.signal,
    })
      .then((res) => {
        stableSetItems(res.items);
        setTotalItems(res.totalItems);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  }, [appId, state.page, state.pageSize, state.sort, state.order, runTypeValue, statusValue, qValue, stableSetItems]);

  useEffect(() => { loadRuns(); }, [loadRuns, location.key]);

  // Tracked jobs that haven't appeared as eval_runs yet (only shown on page 1, no filters)
  const trackedJobs = useJobTrackerStore((s) => s.activeJobs);
  const allRunIds = useMemo(() => new Set(items.map((r) => r.id)), [items]);
  const pendingTrackedJobs = useMemo(() => {
    if (state.page !== 1 || activeFilterCount > 0) return [];
    return trackedJobs
      .filter((j) => j.appId === appId)
      .filter((j) => !j.runId || !allRunIds.has(j.runId));
  }, [trackedJobs, allRunIds, appId, state.page, activeFilterCount]);

  const hasActive = useMemo(
    () => items.some((r) => isActiveStatus(r.status)),
    [items],
  );

  usePoll({
    fn: async () => { loadRuns(); return true; },
    enabled: hasActive || pendingTrackedJobs.length > 0,
  });

  /* ── Build table rows ──────────────────────────────────── */

  const tableData = useMemo((): TableRow[] => {
    const queuedRows: TableRow[] = pendingTrackedJobs.map((job) => ({
      id: job.jobId,
      kind: 'queued',
      runType: jobTypeToRunType(job.jobType),
      title: job.label,
      status: 'queued',
      score: '--',
      scoreColor: 'var(--text-muted)',
      dateStr: timeAgo(new Date(job.trackedAt).toISOString()),
      isRunning: false,
      hasHumanReview: false,
    }));

    const runRows: TableRow[] = items.map((run): TableRow => {
      const { value: score, color: scoreColor, badge: scoreBadge } = getRunScore(run);
      const st = mapEvalRunStatus(run.status);
      const totalItemsCount =
        (run.summary as Record<string, unknown> | undefined)?.total_threads as number | undefined ??
        (run.summary as Record<string, unknown> | undefined)?.total_tests as number | undefined ??
        (run as unknown as { total_items?: number }).total_items ??
        undefined;
      const itemsLabel =
        totalItemsCount != null
          ? `${totalItemsCount} ${run.evalType === 'batch_adversarial' ? 'tests' : 'threads'}`
          : run.evalType;
      return {
        id: run.id,
        kind: 'run',
        runType: deriveRunTypeFromEvalType(run.evalType),
        title: getRunName(run),
        status: st,
        score,
        scoreColor,
        scoreBadge,
        visibility: run.visibility,
        ownerName: run.ownerName ?? undefined,
        items: itemsLabel,
        duration: run.durationMs ? formatDuration(run.durationMs / 1000) : '--',
        modelName: run.llmModel || undefined,
        provider: run.llmProvider || undefined,
        dateStr: run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : '',
        isRunning: st === 'running',
        jobId: (run as unknown as { jobId?: string }).jobId,
        hasHumanReview: !!run.latestReviewId,
        run,
      };
    });

    return [...queuedRows, ...runRows];
  }, [items, pendingTrackedJobs]);

  /* ── Actions ────────────────────────────────────────────── */

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setItems((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setTotalItems((t) => Math.max(0, t - 1));
      setDeleteTarget(null);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed', 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  const handleCancel = useCallback(async (jobId: string) => {
    try {
      await jobsApi.cancel(jobId);
      loadRuns();
    } catch {
      // Cancel failed silently — polling will show real status
    }
  }, [loadRuns]);

  /* ── Navigation ────────────────────────────────────────── */

  const handleRowClick = useCallback((row: TableRow) => {
    if (row.kind === 'queued') return;
    if (row.runType === 'batch' || row.runType === 'adversarial') {
      navigate(runDetailForApp(appId, row.id));
    } else {
      navigate(`${apiLogsForApp(appId)}?run_id=${row.id}`);
    }
  }, [navigate, appId]);

  /* ── Column definitions ────────────────────────────────── */

  const columns = useMemo((): ColumnDef<TableRow>[] => [
    {
      key: 'type',
      header: 'TYPE',
      width: 'w-[110px]',
      render: (row) => {
        const config = RUN_TYPE_CONFIG[row.runType];
        return (
          <span
            className="inline-flex items-center justify-center px-2.5 py-1 rounded text-[10px] font-bold tracking-wider text-white whitespace-nowrap"
            style={{ backgroundColor: config.color }}
          >
            {config.label}
          </span>
        );
      },
    },
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
        <div className="flex flex-col">
          <span className="text-sm font-semibold" style={{ color: row.scoreColor }}>
            {row.score}
          </span>
          {row.scoreBadge && (
            <span className="text-[10px] text-[var(--text-muted)] leading-tight">
              {row.scoreBadge}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'STATUS',
      width: 'w-[120px]',
      sortable: true,
      render: (row) => {
        if (row.status === 'queued') {
          return (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap border-[var(--color-info)] text-[var(--color-info)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Queued
            </span>
          );
        }
        const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
        return (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap"
            style={{ borderColor: style.color, color: style.color }}
          >
            <span
              className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', style.pulseClass)}
              style={{ backgroundColor: style.dot }}
            />
            {style.label}
          </span>
        );
      },
    },
    {
      key: 'visibility',
      header: 'VISIBILITY',
      width: 'w-24',
      render: (row) => row.visibility ? <VisibilityBadge visibility={row.visibility} compact /> : <span className="text-[var(--text-muted)]">--</span>,
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
      key: 'items',
      header: 'ITEMS',
      width: 'w-20',
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">{row.items ?? '--'}</span>
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
      render: (row) => {
        // Queued synthetic rows use row.id as the jobId (see tableData builder);
        // real rows carry jobId on the run record. A Cancel action needs a jobId
        // either way, so we resolve it once here.
        const jobId = row.jobId ?? (row.kind === 'queued' ? row.id : undefined);
        const isActive = row.status === 'queued' || row.status === 'pending' || row.isRunning;
        const canCancel = isActive && !!jobId;
        return (
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
                {canCancel && (
                  <PermissionGate action="evaluation:cancel">
                    <button
                      type="button"
                      onClick={() => {
                        handleCancel(jobId!);
                        setMenuOpenId(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-error)] hover:bg-[var(--interactive-secondary)]"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Cancel
                    </button>
                  </PermissionGate>
                )}
                {row.kind === 'run' && (
                  <PermissionGate action="evaluation:delete">
                    <button
                      type="button"
                      disabled={isActive}
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
                )}
              </PopoverContent>
            </Popover>
          </div>
        );
      },
    },
  ], [menuOpenId, handleCancel]);

  /* ── Error state ───────────────────────────────────────── */

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        Failed to load runs: {error}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  const sortState: SortState | undefined = state.sort && state.order
    ? { key: state.sort, order: state.order }
    : undefined;

  const toolbar = (
    <div className="flex items-center gap-2">
      <FilterButton activeCount={activeFilterCount} onClick={() => setFilterPanelOpen(true)} />
    </div>
  );

  const body = (
    <>
      <DataTable
        columns={columns}
        data={tableData}
        keyExtractor={(row) => row.id}
        onRowClick={handleRowClick}
        loading={loading}
        emptyIcon={activeFilterCount > 0 ? Search : FlaskConical}
        emptyTitle={activeFilterCount > 0 ? 'No matching runs' : 'No runs found'}
        emptyDescription={
          activeFilterCount > 0
            ? 'Try changing the filters or search query.'
            : 'Start a batch evaluation, adversarial test, or run a custom evaluator to see results here.'
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
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Run"
        description={`Delete run "${deleteTarget?.label ?? ''}"? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </>
  );

  if (surface) {
    return (
      <PageSurface
        icon={surface.icon}
        title={surface.title}
        subtitle={surface.subtitle}
        actions={surface.actions}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex justify-end">{toolbar}</div>
          {body}
        </div>
      </PageSurface>
    );
  }

  return (
    <PageShell title="All Runs" filterSlot={toolbar}>
      {body}
    </PageShell>
  );
}
