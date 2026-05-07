import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';

import {
  Badge,
  DataTable,
  EmptyState,
  FilterPills,
  LoadingState,
  PageHeaderSearch,
  type BadgeVariant,
  type ColumnDef,
} from '@/components/ui';
import type { RecipientState, RunStatus } from '@/features/orchestration/types';
import { useRunRecipients } from '@/features/orchestration/queries/runs';

interface Props {
  runId: string;
  /** Run-level status (drives the polling cadence — TQ stops refetching
   *  once the run is terminal). */
  runStatus: RunStatus | null;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATUS_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

// Recipient.status is a free-form string today (not the strict RunStatus
// union). Map common values to visually consistent badge variants;
// anything else falls through to neutral.
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: 'success',
  running: 'info',
  pending: 'neutral',
  waiting: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

function formatAbsolute(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Recipients tab inside the run inspector. Mirrors `ScheduleHistoryOverlay`'s
 * shape: search + status pills + `<DataTable>` with built-in pagination.
 *
 * Server today returns a flat list (no cursor); we client-side filter +
 * paginate. When the backend grows cursor support, swap the queryFn
 * and remove the local slice — column defs and chrome stay.
 */
export function RunRecipientsPanel({ runId, runStatus }: Props) {
  const recipientsQuery = useRunRecipients(runId, {
    pageSize: 100,
    runStatus: runStatus ?? undefined,
  });
  const recipients = useMemo(
    () => recipientsQuery.data ?? [],
    [recipientsQuery.data],
  );

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipients.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        r.recipientId,
        r.currentNodeId ?? '',
        r.status,
        JSON.stringify(r.payload ?? {}),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [recipients, search, statusFilter]);

  // Reset pagination when the slice changes — co-located with the cause,
  // mirroring the ScheduleHistoryOverlay pattern.
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const statusOptions = useMemo(() => {
    return STATUS_OPTIONS.map((option) => {
      if (option.id === 'all') {
        return { ...option, count: recipients.length };
      }
      const count = recipients.filter((r) => r.status === option.id).length;
      return { ...option, count };
    });
  }, [recipients]);

  const columns = useMemo<ColumnDef<RecipientState>[]>(
    () => [
      {
        key: 'recipient-id',
        header: 'Recipient',
        width: 'min-w-[180px]',
        render: (r) => (
          <span className="font-mono text-[length:var(--text-table-cell)] text-[var(--text-primary)]">
            {r.recipientId}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 'w-[120px]',
        render: (r) => (
          <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'}>{r.status}</Badge>
        ),
      },
      {
        key: 'current-node',
        header: 'Current node',
        width: 'min-w-[160px]',
        render: (r) =>
          r.currentNodeId ? (
            <span className="font-mono text-[length:var(--text-table-cell)] text-[var(--text-secondary)]">
              {r.currentNodeId}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
      {
        key: 'enrolled',
        header: 'Enrolled',
        width: 'min-w-[160px]',
        render: (r) => (
          <span className="tabular-nums text-[var(--text-secondary)]">
            {formatAbsolute(r.enrolledAt)}
          </span>
        ),
      },
      {
        key: 'completed',
        header: 'Completed',
        width: 'min-w-[160px]',
        render: (r) => (
          <span className="tabular-nums text-[var(--text-secondary)]">
            {formatAbsolute(r.completedAt)}
          </span>
        ),
      },
      {
        key: 'wakeup',
        header: 'Wake-up',
        width: 'min-w-[160px]',
        render: (r) =>
          r.wakeupAt ? (
            <span className="tabular-nums text-[var(--text-secondary)]">
              {formatAbsolute(r.wakeupAt)}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
      {
        key: 'error',
        header: 'Error',
        width: 'min-w-[200px]',
        render: (r) =>
          r.error ? (
            <span
              className="line-clamp-2 text-[var(--color-danger)]"
              title={r.error}
            >
              {r.error}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
    ],
    [],
  );

  if (recipientsQuery.isLoading && recipients.length === 0) {
    return <LoadingState />;
  }
  if (recipientsQuery.isError) {
    return (
      <EmptyState
        icon={Users}
        title="Failed to load recipients"
        description={(recipientsQuery.error as Error)?.message ?? 'Unknown error'}
        action={{ label: 'Retry', onClick: () => recipientsQuery.refetch() }}
        fill
      />
    );
  }
  if (recipients.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No recipients on this run"
        description="The cohort query returned zero rows for this run."
        fill
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      <div className="flex flex-col gap-2">
        <PageHeaderSearch
          value={search}
          onChange={handleSearchChange}
          placeholder="Search recipient id, node id, status, payload…"
          label="Search recipients"
        />
        <FilterPills
          options={statusOptions}
          active={statusFilter}
          onChange={handleStatusChange}
          size="sm"
        />
      </div>
      <DataTable
        data={paged}
        columns={columns}
        keyExtractor={(r) => r.recipientId}
        emptyIcon={Users}
        emptyTitle="No matches"
        emptyDescription="No recipients match the current search or filter."
        minWidth="960px"
        pagination={{
          page: safePage,
          totalPages,
          totalItems: filtered.length,
          onPageChange: setPage,
          pageSize,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onPageSizeChange: handlePageSizeChange,
          showCount: true,
        }}
      />
    </div>
  );
}
