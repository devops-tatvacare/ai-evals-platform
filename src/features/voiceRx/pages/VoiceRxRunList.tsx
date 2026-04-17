import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePoll, useTableQueryParams } from '@/hooks';
import {
  FlaskConical,
  Search,
  Clock,
  MoreVertical,
  Trash2,
} from 'lucide-react';
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
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { fetchEvalRunsPaged, deleteEvalRun } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { useListingsStore } from '@/stores';
import { isActiveStatus } from '@/utils/runStatus';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { useStableEvalRunUpdate } from '@/features/evalRuns/hooks';
import type { RunType } from '@/features/evalRuns/types';
import { RUN_TYPE_CONFIG } from '@/features/evalRuns/types';
import { cn } from '@/utils/cn';
import type { EvalRun } from '@/types';

/* ── Helpers ─────────────────────────────────────────────── */

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
  return 'evaluation';
}

/* ── Status styles ───────────────────────────────────────── */

const STATUS_STYLES: Record<string, { color: string; dot: string; label: string; pulseClass?: string }> = {
  completed:             { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Completed' },
  success:               { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Success' },
  completed_with_errors: { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Partial' },
  partial:               { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Partial' },
  cancelled:             { color: 'var(--color-warning)', dot: 'var(--color-warning)', label: 'Cancelled' },
  failed:                { color: 'var(--color-error)',   dot: 'var(--color-error)',   label: 'Failed' },
  error:                 { color: 'var(--color-error)',   dot: 'var(--color-error)',   label: 'Error' },
  running:               { color: 'var(--color-info)',    dot: 'var(--color-info)',    label: 'Running', pulseClass: 'animate-pulse' },
  pending:               { color: 'var(--text-muted)',    dot: 'var(--text-muted)',    label: 'Pending' },
};

/* ── Table row type ─────────────────────────────────────── */

interface TableRow {
  id: string;
  runType: RunType;
  title: string;
  status: string;
  score: string;
  scoreColor: string;
  visibility?: 'private' | 'shared';
  ownerName?: string;
  evalTypeLabel: string;
  listingName?: string;
  duration: string;
  modelName?: string;
  provider?: string;
  dateStr: string;
  isRunning: boolean;
  hasHumanReview: boolean;
  run: EvalRun;
}

/* ── Filter configuration ────────────────────────────────── */

const FILTER_FIELDS: FilterFieldConfig[] = [
  { key: 'q', label: 'Search', control: 'text', placeholder: 'Search by name or run ID' },
  {
    key: 'run_type',
    label: 'Type',
    control: 'segmented',
    options: [
      { value: 'batch', label: 'Batch' },
      { value: 'evaluation', label: 'Evaluation' },
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

export function VoiceRxRunList() {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const voiceRxListings = useListingsStore((s) => s.listings['voice-rx']);

  const isInitialLoad = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const stableSetRuns = useStableEvalRunUpdate(setRuns);

  const qValue = typeof state.filters.q === 'string' ? state.filters.q : '';
  const runTypeValue =
    typeof state.filters.run_type === 'string' && state.filters.run_type.length > 0
      ? (state.filters.run_type as 'batch' | 'evaluation' | 'custom')
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
      app_id: 'voice-rx',
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
        stableSetRuns(res.items);
        setTotalItems(res.totalItems);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  }, [state.page, state.pageSize, state.sort, state.order, runTypeValue, statusValue, qValue, stableSetRuns]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const hasActive = useMemo(
    () => runs.some((r) => isActiveStatus(r.status)),
    [runs],
  );

  usePoll({
    fn: async () => { loadRuns(); return true; },
    enabled: hasActive,
  });

  /* ── Build table rows ──────────────────────────────────── */

  const listingMap = useMemo(
    () => new Map(voiceRxListings.map((l) => [l.id, l.title])),
    [voiceRxListings],
  );

  const tableData = useMemo((): TableRow[] =>
    runs.map((run): TableRow => {
      const { display, raw } = extractMainScore(run);
      const st = mapStatusForDisplay(run.status);
      return {
        id: run.id,
        runType: mapEvalTypeToRunType(run.evalType),
        title: getEvalRunName(run),
        status: st,
        score: display,
        scoreColor: scoreColor(raw),
        visibility: run.visibility,
        ownerName: run.ownerName ?? undefined,
        evalTypeLabel: getEvalTypeLabel(run),
        listingName: run.listingId ? (listingMap.get(run.listingId) || run.listingId.slice(0, 8)) : undefined,
        duration: run.durationMs ? formatDuration(run.durationMs / 1000) : '--',
        modelName: run.llmModel || undefined,
        provider: run.llmProvider || undefined,
        dateStr: run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : '',
        isRunning: st === 'running',
        hasHumanReview: !!run.latestReviewId,
        run,
      };
    }),
  [runs, listingMap]);

  /* ── Delete handler ────────────────────────────────────── */

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setTotalItems((t) => Math.max(0, t - 1));
      setDeleteTarget(null);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed', 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  /* ── Navigation ────────────────────────────────────────── */

  const handleRowClick = useCallback((row: TableRow) => {
    navigate(routes.voiceRx.runDetail(row.id));
  }, [navigate]);

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
        <span className="text-sm font-semibold" style={{ color: row.scoreColor }}>
          {row.score}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'STATUS',
      width: 'w-[120px]',
      sortable: true,
      render: (row) => {
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
      key: 'eval_type',
      header: 'EVAL TYPE',
      width: 'w-28',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">{row.evalTypeLabel}</span>
      ),
    },
    {
      key: 'duration_ms',
      header: 'DURATION',
      width: 'w-24',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">{row.duration}</span>
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
  ], [menuOpenId]);

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

  return (
    <PageShell title="All Runs" filterSlot={toolbar}>
      <DataTable
        columns={columns}
        data={tableData}
        keyExtractor={(row) => row.id}
        onRowClick={handleRowClick}
        loading={loading}
        emptyIcon={activeFilterCount > 0 ? Search : FlaskConical}
        emptyTitle={activeFilterCount > 0 ? 'No matching runs' : 'No evaluator runs yet'}
        emptyDescription={
          activeFilterCount > 0
            ? 'Try changing the filters or search query.'
            : 'Run an evaluator on a recording to see results here.'
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
        onConfirm={handleDelete}
        title="Delete Run"
        description={`Delete run "${deleteTarget?.label ?? ''}"? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </PageShell>
  );
}
