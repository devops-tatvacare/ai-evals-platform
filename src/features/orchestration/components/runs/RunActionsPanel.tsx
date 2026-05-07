import { useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';

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
import type { ActionRow, RunStatus } from '@/features/orchestration/types';
import { useRunActions } from '@/features/orchestration/queries/runs';

interface Props {
  runId: string;
  runStatus: RunStatus | null;
  /** Click on an action row → opens the secondary action-detail overlay
   *  via the parent's URL state. `null` from the close handler clears
   *  the selection. */
  onSelectAction(actionId: string | null): void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const CHANNEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All channels' },
  { id: 'wati', label: 'WATI' },
  { id: 'bolna', label: 'Bolna' },
  { id: 'sms', label: 'SMS' },
  { id: 'lsq', label: 'LSQ' },
  { id: 'system', label: 'System' },
  { id: 'webhook', label: 'Webhook' },
];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  success: 'success',
  pending: 'neutral',
  failed: 'danger',
  retryable: 'warning',
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
 * Action log tab inside the run inspector. Rows are clickable —
 * selecting one drives the URL into `?action=<id>` and opens the
 * secondary overlay over this panel.
 */
export function RunActionsPanel({ runId, runStatus, onSelectAction }: Props) {
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);

  const actionsQuery = useRunActions(runId, {
    pageSize: 200,
    channel: channel === 'all' ? null : channel,
    runStatus: runStatus ?? undefined,
  });
  const actions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const haystack = [
        a.id,
        a.recipientId,
        a.channel,
        a.actionType,
        a.status,
        a.providerCorrelationId ?? '',
        a.providerStatus ?? '',
        a.error ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [actions, search]);

  const handleSearchChange = (next: string) => {
    setSearch(next);
    setPage(1);
  };
  const handleChannelChange = (next: string) => {
    setChannel(next);
    setPage(1);
  };
  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const channelOptions = useMemo(() => {
    return CHANNEL_OPTIONS.map((option) => {
      if (option.id === 'all') {
        return { ...option, count: actions.length };
      }
      const count = actions.filter(
        (a) => (a.channel || '').toLowerCase() === option.id,
      ).length;
      return { ...option, count };
    });
  }, [actions]);

  const columns = useMemo<ColumnDef<ActionRow>[]>(
    () => [
      {
        key: 'created',
        header: 'When',
        width: 'min-w-[150px]',
        render: (a) => (
          <span className="tabular-nums text-[var(--text-secondary)]">
            {formatAbsolute(a.createdAt)}
          </span>
        ),
      },
      {
        key: 'recipient',
        header: 'Recipient',
        width: 'min-w-[160px]',
        render: (a) => (
          <span className="font-mono text-[length:var(--text-table-cell)] text-[var(--text-primary)]">
            {a.recipientId}
          </span>
        ),
      },
      {
        key: 'channel',
        header: 'Channel',
        width: 'w-[110px]',
        render: (a) => (
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            {a.channel}
          </span>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        width: 'min-w-[200px]',
        render: (a) => (
          <span className="font-mono text-[length:var(--text-table-cell)] text-[var(--text-primary)]">
            {a.actionType}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 'w-[120px]',
        render: (a) => (
          <Badge variant={STATUS_VARIANT[a.status] ?? 'neutral'}>
            {a.status}
          </Badge>
        ),
      },
      {
        key: 'provider',
        header: 'Provider correlation',
        width: 'min-w-[180px]',
        render: (a) =>
          a.providerCorrelationId ? (
            <span
              className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]"
              title={a.providerCorrelationId}
            >
              {a.providerCorrelationId.length > 18
                ? `${a.providerCorrelationId.slice(0, 8)}…${a.providerCorrelationId.slice(-6)}`
                : a.providerCorrelationId}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
      {
        key: 'error',
        header: 'Error',
        width: 'min-w-[180px]',
        render: (a) =>
          a.error ? (
            <span className="line-clamp-2 text-[var(--color-danger)]" title={a.error}>
              {a.error}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
    ],
    [],
  );

  if (actionsQuery.isLoading && actions.length === 0) {
    return <LoadingState />;
  }
  if (actionsQuery.isError) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Failed to load action log"
        description={(actionsQuery.error as Error)?.message ?? 'Unknown error'}
        action={{ label: 'Retry', onClick: () => actionsQuery.refetch() }}
        fill
      />
    );
  }
  if (actions.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No actions recorded"
        description="No dispatches or system actions have been logged for this run yet."
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
          placeholder="Search recipient, action, correlation id, error…"
          label="Search actions"
        />
        <FilterPills
          options={channelOptions}
          active={channel}
          onChange={handleChannelChange}
          size="sm"
        />
      </div>
      <DataTable
        data={paged}
        columns={columns}
        keyExtractor={(a) => a.id}
        onRowClick={(a) => onSelectAction(a.id)}
        emptyIcon={ListChecks}
        emptyTitle="No matches"
        emptyDescription="No actions match the current search or filter."
        minWidth="1100px"
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
