import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePoll } from '@/hooks';
import {
  FlaskConical,
  Search,
  Clock,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog, ModelBadge, VisibilityBadge, detectProvider } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { PageShell } from '@/components/ui/PageShell';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { fetchEvalRuns, deleteEvalRun } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { useListingsStore } from '@/stores';
import { isActiveStatus } from '@/utils/runStatus';
import { routes } from '@/config/routes';
import { timeAgo, formatDuration } from '@/utils/evalFormatters';
import { useStableEvalRunUpdate, useDebouncedValue } from '@/features/evalRuns/hooks';
import type { RunType } from '@/features/evalRuns/types';
import { RUN_TYPE_CONFIG } from '@/features/evalRuns/types';
import { cn } from '@/utils/cn';
import type { EvalRun } from '@/types';

const PAGE_SIZE = 15;

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
  flowType?: string;
  duration: string;
  modelName?: string;
  provider?: string;
  dateStr: string;
  isRunning: boolean;
  hasHumanReview: boolean;
  run: EvalRun;
}

/* ── Filter chip configs ─────────────────────────────────── */

const TYPE_FILTERS: Array<{ key: RunType | 'all'; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'batch', label: 'Batch', dotColor: RUN_TYPE_CONFIG.batch.color },
  { key: 'evaluation', label: 'Evaluation', dotColor: RUN_TYPE_CONFIG.evaluation.color },
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
  const navigate = useNavigate();
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<RunType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
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
  const hasActive = useMemo(
    () => runs.some((r) => isActiveStatus(r.status)),
    [runs],
  );

  usePoll({
    fn: async () => { loadRuns(); return true; },
    enabled: hasActive,
  });

  /* ── Filtering ─────────────────────────────────────────── */

  const filteredRuns = useMemo(() => {
    let result = runs;

    if (typeFilter !== 'all') {
      result = result.filter((r) => mapEvalTypeToRunType(r.evalType) === typeFilter);
    }

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

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((r) =>
        getEvalRunName(r).toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
      );
    }

    return result;
  }, [runs, typeFilter, statusFilter, debouncedSearch]);

  /* ── Build table rows ──────────────────────────────────── */

  const listingMap = useMemo(
    () => new Map(voiceRxListings.map((l) => [l.id, l.title])),
    [voiceRxListings],
  );

  const tableData = useMemo((): TableRow[] =>
    filteredRuns.map((run): TableRow => {
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
        flowType: run.flowType ?? undefined,
        duration: run.durationMs ? formatDuration(run.durationMs / 1000) : '--',
        modelName: run.llmModel || undefined,
        provider: run.llmProvider || undefined,
        dateStr: run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : '',
        isRunning: st === 'running',
        hasHumanReview: !!run.latestReviewId,
        run,
      };
    }),
  [filteredRuns, listingMap]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(tableData.length / PAGE_SIZE));
  const pagedData = tableData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /* ── Delete handler ────────────────────────────────────── */

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
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
      key: 'evalType',
      header: 'EVAL TYPE',
      width: 'w-28',
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)]">{row.evalTypeLabel}</span>
      ),
    },
    {
      key: 'duration',
      header: 'DURATION',
      width: 'w-24',
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

  const hasActiveFilters = typeFilter !== 'all' || statusFilter !== 'all' || debouncedSearch.length > 0;

  /* ── Filter slot ───────────────────────────────────────── */

  const filterSlot = (
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

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Type</span>
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
              typeFilter === f.key
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

        <span className="text-[var(--border-default)] mx-1">|</span>

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

  return (
    <PageShell title="All Runs" filterSlot={filterSlot}>
      <DataTable
        columns={columns}
        data={pagedData}
        keyExtractor={(row) => row.id}
        onRowClick={handleRowClick}
        loading={loading}
        emptyIcon={hasActiveFilters ? Search : FlaskConical}
        emptyTitle={hasActiveFilters ? 'No matching runs' : 'No evaluator runs yet'}
        emptyDescription={
          hasActiveFilters
            ? 'Try changing the filters or search query.'
            : 'Run an evaluator on a recording to see results here.'
        }
        pagination={{ page: page + 1, totalPages, onPageChange: (p) => setPage(p - 1) }}
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
