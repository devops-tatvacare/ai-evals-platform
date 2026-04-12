import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePoll } from '@/hooks';
import {
  FlaskConical,
  Search,
  Loader2,
  Clock,
  MoreVertical,
  Trash2,
  Square,
} from 'lucide-react';
import type { Run, EvalRun } from '@/types';
import { fetchRuns, deleteRun, fetchEvalRuns, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import {
  ConfirmDialog,
  ModelBadge,
  VisibilityBadge,
  detectProvider,
} from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { PageShell } from '@/components/ui/PageShell';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { PermissionGate } from '@/components/auth/PermissionGate';
import { isActiveStatus } from '@/utils/runStatus';
import { inferAppIdFromPath, runDetailForApp, apiLogsForApp } from '@/config/routes';
import { timeAgo, formatDuration, humanize } from '@/utils/evalFormatters';
import { useStableRunUpdate, useStableEvalRunUpdate, useDebouncedValue } from '../hooks';
import { useJobTrackerStore } from '@/stores';
import { cn } from '@/utils/cn';
import type { RunType } from '../types';
import { RUN_TYPE_CONFIG } from '../types';

const PAGE_SIZE = 15;

/* ── Helpers ─────────────────────────────────────────────── */

function getRunName(run: EvalRun): string {
  const s = run.summary as Record<string, unknown> | undefined;
  const c = run.config as Record<string, unknown> | undefined;
  return (s?.evaluator_name as string) ?? (c?.evaluator_name as string) ?? run.evalType ?? 'Unknown';
}

function getRunScore(run: EvalRun): { value: string; color: string } {
  const s = run.summary as Record<string, unknown> | undefined;
  if (!s) return { value: '--', color: 'var(--text-muted)' };
  for (const [, v] of Object.entries(s)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) {
      return {
        value: `${(v * 100).toFixed(0)}%`,
        color: v >= 0.7 ? 'var(--color-success)' : v >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)',
      };
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

function deriveRunType(command: string): RunType {
  if (command.includes('batch')) return 'batch';
  if (command.includes('adversarial')) return 'adversarial';
  if (command.includes('thread')) return 'thread';
  return 'custom';
}

function deriveCustomRunType(evalType: string): RunType {
  if (evalType === 'batch_thread' || evalType === 'batch_adversarial') return 'batch';
  if (evalType === 'custom') return 'custom';
  if (evalType === 'full_evaluation') return 'evaluation';
  return 'thread';
}

function deriveStatusFromRun(run: Run): string {
  const s = run.status.toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'completed_with_errors') return 'completed_with_errors';
  if (s === 'failed' || s === 'interrupted') return 'failed';
  if (s === 'running') return 'running';
  if (s === 'cancelled') return 'cancelled';
  return 'pending';
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
  kind: 'batch' | 'custom' | 'queued';
  runType: RunType;
  title: string;
  status: string;
  score: string;
  scoreColor: string;
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
  // keep originals for delete/navigate
  batchRun?: Run;
  customRun?: EvalRun;
}

/* ── Filter chip configs ─────────────────────────────────── */

const TYPE_FILTERS: Array<{ key: RunType | 'all'; label: string; dotColor?: string }> = [
  { key: 'all', label: 'All' },
  { key: 'batch', label: 'Batch', dotColor: RUN_TYPE_CONFIG.batch.color },
  { key: 'adversarial', label: 'Adversarial', dotColor: RUN_TYPE_CONFIG.adversarial.color },
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

export default function RunList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [runs, setRuns] = useState<Run[]>([]);
  const [customRuns, setCustomRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [typeFilter, setTypeFilter] = useState<RunType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  // Pagination
  const [page, setPage] = useState(0);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; kind: 'batch' | 'custom'; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Actions popover
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Shimmer fix: only show loading on first load
  const isInitialLoad = useRef(true);
  const stableSetRuns = useStableRunUpdate(setRuns);
  const stableSetCustomRuns = useStableEvalRunUpdate(setCustomRuns);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [typeFilter, statusFilter, debouncedSearch]);

  const loadRuns = useCallback(() => {
    if (isInitialLoad.current) {
      setLoading(true);
    }
    setError('');
    Promise.all([
      fetchRuns({ app_id: 'kaira-bot', limit: 200 }).then((r) => r.runs).catch(() => [] as Run[]),
      fetchEvalRuns({ app_id: 'kaira-bot', eval_type: 'custom', limit: 200 }).catch(() => [] as EvalRun[]),
    ])
      .then(([batchRuns, customRunsResult]) => {
        stableSetRuns(batchRuns);
        stableSetCustomRuns(customRunsResult);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  }, [stableSetRuns, stableSetCustomRuns]);

  useEffect(() => { loadRuns(); }, [loadRuns, location.key]);

  // Tracked jobs that haven't appeared as eval_runs yet
  const trackedJobs = useJobTrackerStore((s) => s.activeJobs);
  const allRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of runs) ids.add(r.run_id);
    for (const r of customRuns) ids.add(r.id);
    return ids;
  }, [runs, customRuns]);

  const pendingTrackedJobs = useMemo(
    () => trackedJobs
      .filter((j) => j.appId === 'kaira-bot')
      .filter((j) => !j.runId || !allRunIds.has(j.runId)),
    [trackedJobs, allRunIds],
  );

  // Light polling when runs are active OR there are pending tracked jobs
  const hasActive = useMemo(
    () => [...runs, ...customRuns].some((r) => {
      const status = 'status' in r ? r.status : '';
      return isActiveStatus(status);
    }),
    [runs, customRuns],
  );

  usePoll({
    fn: async () => { loadRuns(); return true; },
    enabled: hasActive || pendingTrackedJobs.length > 0,
  });

  /* ── Unified + filtered items ──────────────────────────── */

  type UnifiedItem =
    | { _kind: 'batch'; ts: number; data: Run }
    | { _kind: 'custom'; ts: number; data: EvalRun };

  const unifiedItems = useMemo((): UnifiedItem[] => {
    const customRunIds = new Set(customRuns.map((r) => r.id));
    const items: UnifiedItem[] = [
      ...runs
        .filter((r) => !customRunIds.has(r.run_id))
        .map((r): UnifiedItem => ({ _kind: 'batch', ts: new Date(r.timestamp).getTime(), data: r })),
      ...customRuns.map((r): UnifiedItem => ({ _kind: 'custom', ts: new Date(r.createdAt).getTime(), data: r })),
    ];
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [runs, customRuns]);

  const filteredItems = useMemo(() => {
    let result = unifiedItems;

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((item) => {
        if (item._kind === 'batch') return deriveRunType(item.data.command) === typeFilter;
        return deriveCustomRunType(item.data.evalType) === typeFilter;
      });
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((item) => {
        const s = item._kind === 'batch'
          ? deriveStatusFromRun(item.data)
          : mapEvalRunStatus(item.data.status);
        if (statusFilter === 'partial') return s === 'completed_with_errors';
        if (statusFilter === 'failed') return s === 'failed';
        if (statusFilter === 'completed') return s === 'completed';
        if (statusFilter === 'cancelled') return s === 'cancelled';
        if (statusFilter === 'running') return s === 'running';
        return true;
      });
    }

    // Search filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter((item) => {
        if (item._kind === 'batch') {
          const run = item.data;
          return (run.name || run.command).toLowerCase().includes(q) ||
            run.run_id.toLowerCase().includes(q);
        }
        const run = item.data;
        return getRunName(run).toLowerCase().includes(q) ||
          run.id.toLowerCase().includes(q);
      });
    }

    return result;
  }, [unifiedItems, typeFilter, statusFilter, debouncedSearch]);

  /* ── Build table rows ──────────────────────────────────── */

  const appId = inferAppIdFromPath(location.pathname) ?? 'kaira-bot';

  const tableData = useMemo((): TableRow[] => {
    // Queued jobs as rows
    const queuedRows: TableRow[] = pendingTrackedJobs.map((job) => {
      const rt = jobTypeToRunType(job.jobType);
      return {
        id: job.jobId,
        kind: 'queued',
        runType: rt,
        title: job.label,
        status: 'queued',
        score: '--',
        scoreColor: 'var(--text-muted)',
        dateStr: timeAgo(new Date(job.trackedAt).toISOString()),
        isRunning: false,
        hasHumanReview: false,
      };
    });

    // Real runs
    const runRows: TableRow[] = filteredItems.map((item): TableRow => {
      if (item._kind === 'batch') {
        const run = item.data;
        const summary = run.summary ?? {};
        const totalItems =
          (summary.total_threads as number) ??
          (summary.total_tests as number) ??
          run.total_items ??
          0;
        const itemLabel = run.command === 'adversarial' ? 'tests' : 'threads';
        const st = deriveStatusFromRun(run);
        return {
          id: run.run_id,
          kind: 'batch',
          runType: deriveRunType(run.command),
          title: run.name || humanize(run.command),
          status: st,
          score: '--',
          scoreColor: 'var(--text-muted)',
          visibility: run.visibility,
          ownerName: run.ownerName ?? undefined,
          items: `${totalItems} ${itemLabel}`,
          duration: run.duration_seconds > 0 ? formatDuration(run.duration_seconds) : '--',
          modelName: run.llm_model || undefined,
          provider: run.llm_provider || undefined,
          dateStr: timeAgo(run.timestamp),
          isRunning: st === 'running',
          jobId: run.job_id || undefined,
          hasHumanReview: false,
          batchRun: run,
        };
      }
      const run = item.data;
      const { value: score, color: scoreColor } = getRunScore(run);
      const st = mapEvalRunStatus(run.status);
      return {
        id: run.id,
        kind: 'custom',
        runType: deriveCustomRunType(run.evalType),
        title: getRunName(run),
        status: st,
        score,
        scoreColor,
        visibility: run.visibility,
        ownerName: run.ownerName ?? undefined,
        items: run.evalType,
        duration: run.durationMs ? formatDuration(run.durationMs / 1000) : '--',
        modelName: run.llmModel || undefined,
        provider: run.llmProvider || undefined,
        dateStr: run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : '',
        isRunning: st === 'running',
        hasHumanReview: !!run.latestReviewId,
        customRun: run,
      };
    });

    return [...queuedRows, ...runRows];
  }, [filteredItems, pendingTrackedJobs]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(tableData.length / PAGE_SIZE));
  const pagedData = tableData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  /* ── Delete handlers ───────────────────────────────────── */

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.kind === 'batch') {
        await deleteRun(deleteTarget.id);
        setRuns((prev) => prev.filter((r) => r.run_id !== deleteTarget.id));
      } else {
        await deleteEvalRun(deleteTarget.id);
        setCustomRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      }
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
    if (row.kind === 'batch') {
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
      render: (row) => {
        if (row.kind === 'queued') return null;
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
                      setDeleteTarget({
                        id: row.id,
                        kind: row.kind as 'batch' | 'custom',
                        label: row.title,
                      });
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

  const hasActiveFilters = typeFilter !== 'all' || statusFilter !== 'all' || debouncedSearch.length > 0;

  /* ── Filter slot ───────────────────────────────────────── */

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

      {/* Filter chips */}
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
        emptyTitle={hasActiveFilters ? 'No matching runs' : 'No runs found'}
        emptyDescription={
          hasActiveFilters
            ? 'Try changing the filters or search query.'
            : 'Start a batch evaluation, adversarial test, or run a custom evaluator to see results here.'
        }
        pagination={{ page: page + 1, totalPages, onPageChange: (p) => setPage(p - 1) }}
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
    </PageShell>
  );
}
