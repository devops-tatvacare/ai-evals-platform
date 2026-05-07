import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { History, RefreshCw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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

import { ApiError } from '@/services/api/client';
import { listRuns } from '@/services/api/orchestration';
import type {
  RunStatus,
  Workflow,
  WorkflowRun,
} from '@/features/orchestration/types';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import { cn } from '@/utils/cn';

interface Props {
  workflow: Workflow;
  onClose: () => void;
}

const STATUS_OPTIONS: Array<{ id: 'all' | RunStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const STATUS_VARIANT: Record<RunStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
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
  if (!started) return '—';
  const end = completed ? new Date(completed).getTime() : Date.now();
  const ms = end - new Date(started).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export function WorkflowRunHistoryOverlay({ workflow, onClose }: Props) {
  const titleId = useId();
  const navigate = useNavigate();
  const orchestrationRoutes = useOrchestrationRoutes();

  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listRuns({
        workflowId: workflow.id,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setRuns(res.runs);
      setTotal(res.total);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load run history';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [workflow.id, statusFilter, pageSize, page]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  // Auto-refresh while the most recent visible run is non-terminal — same
  // pattern as ScheduleHistoryOverlay's polling. Stops when nothing on the
  // visible page is still in flight.
  useEffect(() => {
    const hasInFlight = runs.some((r) => !TERMINAL.has(r.status));
    if (!hasInFlight) return;
    const t = window.setInterval(() => void fetchPage(), 5_000);
    return () => window.clearInterval(t);
  }, [runs, fetchPage]);

  const handleSearchChange = (next: string) => {
    setSearch(next);
    setPage(1);
  };
  const handleStatusChange = (next: string) => {
    setStatusFilter(next as 'all' | RunStatus);
    setPage(1);
  };
  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const filteredRuns = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return runs;
    return runs.filter(
      (r) =>
        r.id.toLowerCase().includes(needle) ||
        (r.error ?? '').toLowerCase().includes(needle) ||
        r.status.toLowerCase().includes(needle) ||
        r.triggeredBy.toLowerCase().includes(needle),
    );
  }, [runs, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const columns = useMemo<ColumnDef<WorkflowRun>[]>(
    () => [
      {
        key: 'started',
        header: 'Started',
        width: 'min-w-[190px]',
        textBehavior: 'nowrap',
        render: (row) => (
          <div>
            <div className="tabular-nums">{formatAbsolute(row.createdAt)}</div>
            {row.startedAt && row.startedAt !== row.createdAt ? (
              <div className="text-[length:var(--text-table-header)] text-[var(--text-muted)]">
                fired {formatAbsolute(row.startedAt)}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 'w-[130px]',
        render: (row) => (
          <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>
            {row.status}
          </Badge>
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
      {
        key: 'trigger',
        header: 'Trigger',
        width: 'w-[110px]',
        render: (row) => (
          <span className="text-[var(--text-secondary)]">{row.triggeredBy}</span>
        ),
      },
      {
        key: 'cohort',
        header: 'Cohort',
        width: 'w-[80px]',
        cellClassName: 'text-right tabular-nums',
        headerClassName: 'text-right',
        render: (row) => row.cohortSizeAtEntry,
      },
      {
        key: 'run-id',
        header: 'Run ID',
        width: 'min-w-[160px]',
        render: (row) => (
          <span
            className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]"
            title={row.id}
          >
            {row.id.slice(0, 8)}…{row.id.slice(-4)}
          </span>
        ),
      },
      {
        key: 'error',
        header: 'Error',
        width: 'min-w-[240px]',
        render: (row) =>
          row.error ? (
            <span
              className="line-clamp-2 text-[var(--color-danger)]"
              title={row.error}
            >
              {row.error}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
    ],
    [],
  );

  const isEmpty = !loading && !error && total === 0;

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
                <h2
                  id={titleId}
                  className="truncate text-sm font-semibold text-[var(--text-primary)]"
                >
                  {workflow.name}
                </h2>
                <p className="truncate text-[11px] text-[var(--text-muted)]">
                  Run history
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void fetchPage()}
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
              placeholder="Search run id, error message, status…"
              label="Search runs"
            />
            <FilterPills
              options={STATUS_OPTIONS}
              active={statusFilter}
              onChange={handleStatusChange}
              size="sm"
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          {loading && runs.length === 0 ? (
            <LoadingState />
          ) : error ? (
            <EmptyState
              icon={History}
              title="Failed to load run history"
              description={error}
              action={{ label: 'Retry', onClick: () => void fetchPage() }}
              fill
            />
          ) : isEmpty ? (
            <EmptyState
              icon={History}
              title="No runs yet"
              description={
                workflow.currentPublishedVersionId
                  ? 'This workflow has not fired yet. Use Run Now to trigger one.'
                  : 'Publish this workflow before runs can be triggered.'
              }
              fill
            />
          ) : (
            <DataTable
              data={filteredRuns}
              columns={columns}
              keyExtractor={(r) => r.id}
              emptyIcon={History}
              emptyTitle="No matches"
              emptyDescription="No runs match the current search or filter."
              minWidth="820px"
              onRowClick={(r) => {
                onClose();
                navigate(orchestrationRoutes.campaignRunDetail(r.id));
              }}
              pagination={{
                page: safePage,
                totalPages,
                totalItems: total,
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
