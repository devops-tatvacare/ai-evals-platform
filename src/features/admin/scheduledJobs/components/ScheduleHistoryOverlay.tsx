import { useEffect, useId, useMemo, useState } from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import {
  Badge,
  DataTable,
  EmptyState,
  FilterPills,
  LoadingState,
  PageHeaderSearch,
  RightSlideOverShell,
  type BadgeVariant,
  type ColumnDef,
} from '@/components/ui';
import { useScheduledJobsStore } from '@/stores/scheduledJobsStore';
import { cn } from '@/utils';
import type { Schedule, ScheduleFireSummary } from '../types';

interface Props {
  schedule: Schedule;
  onClose: () => void;
  /** Optional deep-link target: highlight + scroll to this fire on open
   *  and preselect the "Failed" status pill so the failure is visible.
   *  Used by mail CTAs landing from `?history=&run=`. */
  focusFireId?: string | null;
}

const STATUS_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'queued', label: 'Queued' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'retryable_failed', label: 'Retryable failed' },
  { id: 'dead_lettered', label: 'Dead-lettered' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: 'success',
  running: 'info',
  queued: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
  retryable_failed: 'warning',
  dead_lettered: 'danger',
};

function formatAbsolute(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(started: string | null, completed: string | null): string {
  if (!started || !completed) return '—';
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function ScheduleHistoryOverlay({ schedule, onClose, focusFireId }: Props) {
  const titleId = useId();
  const fetchDetail = useScheduledJobsStore((state) => state.fetchDetail);
  const entry = useScheduledJobsStore((state) => state.detailById[schedule.id]);
  // Stabilize the empty-array identity so downstream useMemo deps don't
  // invalidate on every render while the detail hasn't loaded yet.
  const fires = useMemo(() => entry?.fires ?? [], [entry?.fires]);
  const loading = entry?.loading ?? false;
  const error = entry?.error ?? null;

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(focusFireId ? 'failed' : 'all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  useEffect(() => {
    void fetchDetail(schedule.id);
  }, [fetchDetail, schedule.id]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fire of fires) {
      counts.set(fire.status, (counts.get(fire.status) ?? 0) + 1);
    }
    return counts;
  }, [fires]);

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.filter(
        (opt) => opt.id === 'all' || (statusCounts.get(opt.id) ?? 0) > 0,
      ).map((opt) => ({
        ...opt,
        label: opt.id === 'all' ? `All (${fires.length})` : `${opt.label} (${statusCounts.get(opt.id) ?? 0})`,
      })),
    [fires.length, statusCounts],
  );

  const filteredFires = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return fires.filter((fire) => {
      if (statusFilter !== 'all' && fire.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        fire.id.toLowerCase().includes(needle) ||
        (fire.errorMessage ?? '').toLowerCase().includes(needle) ||
        fire.status.toLowerCase().includes(needle)
      );
    });
  }, [fires, search, statusFilter]);

  // Filter / page-size changes reset pagination to the first page. Done
  // inside the setter wrappers instead of a useEffect so we don't incur a
  // "setState in effect" smell and the reset is co-located with the cause.
  const handleSearchChange = (next: string) => {
    setSearch(next);
    setPage(1);
  };
  const handleStatusChange = (next: string) => {
    setStatusFilter(next);
    setPage(1);
  };
  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filteredFires.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedFires = filteredFires.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Hide the Rows column when no visible fire reports a row count — keeps the
  // overlay clean for evaluation-style schedules that have no row concept.
  const showRowsColumn = useMemo(
    () => filteredFires.some((fire) => fire.rows !== null && fire.rows !== undefined),
    [filteredFires],
  );

  const columns = useMemo<ColumnDef<ScheduleFireSummary>[]>(
    () => {
      const cols: ColumnDef<ScheduleFireSummary>[] = [
        {
          key: 'fired-at',
          header: 'Fired at',
          width: 'min-w-[190px]',
          render: (row) => (
            <div>
              <div className="tabular-nums">{formatAbsolute(row.createdAt)}</div>
              {row.startedAt && row.startedAt !== row.createdAt ? (
                <div className="text-[length:var(--text-table-header)] text-[var(--text-muted)]">
                  started {formatAbsolute(row.startedAt)}
                </div>
              ) : null}
            </div>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          width: 'w-[140px]',
          render: (row) => (
            <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>{row.status}</Badge>
          ),
        },
        {
          key: 'duration',
          header: 'Duration',
          width: 'w-[100px]',
          render: (row) => (
            <span className="tabular-nums text-[var(--text-secondary)]">
              {formatDuration(row.startedAt, row.completedAt)}
            </span>
          ),
        },
      ];

      if (showRowsColumn) {
        cols.push({
          key: 'rows',
          header: 'Rows',
          width: 'w-[90px]',
          cellClassName: 'text-right tabular-nums',
          headerClassName: 'text-right',
          render: (row) =>
            row.rows !== null && row.rows !== undefined ? (
              <span>{row.rows.toLocaleString()}</span>
            ) : (
              <span className="text-[var(--text-muted)]">—</span>
            ),
        });
      }

      cols.push(
        {
          key: 'job-id',
          header: 'Job ID',
          width: 'min-w-[160px]',
          render: (row) => (
            <span className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]" title={row.id}>
              {row.id.slice(0, 8)}…{row.id.slice(-4)}
            </span>
          ),
        },
        {
          key: 'error',
          header: 'Error',
          width: 'min-w-[240px]',
          render: (row) =>
            row.errorMessage ? (
              <span
                className="line-clamp-2 text-[var(--color-danger)]"
                title={row.errorMessage}
              >
                {row.errorMessage}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">—</span>
            ),
        },
      );

      return cols;
    },
    [showRowsColumn],
  );

  const isEmpty = !loading && !error && fires.length === 0;

  return (
    <RightSlideOverShell
      isOpen={true}
      onClose={onClose}
      labelledBy={titleId}
      widthClassName="w-[var(--overlay-width-lg)] max-w-[92vw]"
    >
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <History className="mt-0.5 h-4 w-4 text-[var(--text-muted)]" />
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {schedule.name}
                </h2>
                <p className="truncate text-[11px] text-[var(--text-muted)]">
                  {schedule.scheduleKey}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void fetchDetail(schedule.id)}
                disabled={loading}
                className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                title="Refresh"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </button>
              <button
                onClick={onClose}
                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <PageHeaderSearch
              value={search}
              onChange={handleSearchChange}
              placeholder="Search job id, error message, status…"
              label="Search runs"
            />
            <FilterPills
              options={statusOptions}
              active={statusFilter}
              onChange={handleStatusChange}
              size="sm"
            />
            {focusFireId ? (
              <div className="rounded-md border border-[var(--border-warning)] bg-[var(--color-warning-light)] px-3 py-2 text-[11px] text-[var(--color-warning-dark)]">
                Opened from an email alert — showing the failed run{' '}
                <span className="font-mono">{focusFireId.slice(0, 8)}…{focusFireId.slice(-4)}</span>.
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          {loading && fires.length === 0 ? (
            <LoadingState />
          ) : error ? (
            <EmptyState
              icon={History}
              title="Failed to load run history"
              description={error}
              action={{ label: 'Retry', onClick: () => void fetchDetail(schedule.id) }}
              fill
            />
          ) : isEmpty ? (
            <EmptyState
              icon={History}
              title="No runs yet"
              description="This schedule has not fired yet. Trigger it with Fire now to see a run here."
              fill
            />
          ) : (
            <DataTable
              data={pagedFires}
              columns={columns}
              keyExtractor={(fire) => fire.id}
              emptyIcon={History}
              emptyTitle="No matches"
              emptyDescription="No runs match the current search or filter."
              minWidth="720px"
              pagination={{
                page: safePage,
                totalPages,
                totalItems: filteredFires.length,
                onPageChange: setPage,
                pageSize,
                pageSizeOptions: PAGE_SIZE_OPTIONS,
                onPageSizeChange: handlePageSizeChange,
                showCount: true,
              }}
            />
          )}
        </div>
      </div>
    </RightSlideOverShell>
  );
}
