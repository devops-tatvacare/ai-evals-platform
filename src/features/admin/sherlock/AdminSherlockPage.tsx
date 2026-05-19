import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Badge, FilterPills, PageSurface } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { routes } from '@/config/routes';
import { usePageMetadata } from '@/config/pageMetadata';
import { timeAgo } from '@/utils/evalFormatters';

import { useToolCallsList } from '@/features/sherlock/queries/parts';
import type { SherlockPartRow } from '@/services/api/sherlockParts';
import type { ToolPart } from '@/features/sherlock/generated/sherlockContract';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'error', label: 'Error' },
  { id: 'running', label: 'Running' },
];

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  completed: 'success',
  error: 'danger',
  running: 'warning',
  pending: 'neutral',
};

function durationMs(part: ToolPart): number | null {
  const state = part.state as { started_at?: string; ended_at?: string };
  if (!state.started_at || !state.ended_at) return null;
  const start = Date.parse(state.started_at);
  const end = Date.parse(state.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return end - start;
}

function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusOf(part: ToolPart): string {
  return (part.state as { status?: string }).status ?? 'pending';
}

function inputSummary(part: ToolPart): string {
  const input = (part.state as { input?: Record<string, unknown> }).input;
  if (!input || Object.keys(input).length === 0) return '—';
  const json = JSON.stringify(input);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

export function AdminSherlockPage() {
  const navigate = useNavigate();
  const { icon, title } = usePageMetadata('sherlock');
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? 'all';

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  const updateParam = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      setSearchParams(params);
      setPage(1);
    },
    [searchParams, setSearchParams],
  );

  const offset = (page - 1) * pageSize;
  const partsQuery = useToolCallsList({ limit: pageSize, offset });

  const allRows = partsQuery.data?.items ?? [];
  const rows = useMemo(
    () => (status === 'all' ? allRows : allRows.filter((r) => statusOf(r.payload as ToolPart) === status)),
    [allRows, status],
  );
  const total = partsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns: ColumnDef<SherlockPartRow>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'When',
        render: (row) => (
          <span className="text-[var(--text-muted)]">{timeAgo(row.createdAt)}</span>
        ),
      },
      {
        key: 'appId',
        header: 'App',
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">{row.appId}</span>
        ),
      },
      {
        key: 'toolName',
        header: 'Tool',
        render: (row) => (
          <Badge variant="info" size="sm">
            {(row.payload as ToolPart).tool}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => {
          const s = statusOf(row.payload as ToolPart);
          return (
            <Badge variant={STATUS_VARIANT[s] ?? 'neutral'} size="sm">
              {s}
            </Badge>
          );
        },
      },
      {
        key: 'duration',
        header: 'Duration',
        render: (row) => (
          <span className="text-[var(--text-secondary)]">
            {formatMs(durationMs(row.payload as ToolPart))}
          </span>
        ),
      },
      {
        key: 'args',
        header: 'Arguments',
        render: (row) => (
          <span className="truncate text-xs text-[var(--text-muted)]">
            {inputSummary(row.payload as ToolPart)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <PageSurface
      icon={icon}
      title={title}
      subtitle="Tenant-wide Sherlock tool-call activity"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterPills
            options={STATUS_PILLS}
            active={status}
            onChange={(id) => updateParam({ status: id === 'all' ? null : id })}
            size="sm"
          />
        </div>

        {partsQuery.isError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-8">
            <div className="w-full max-w-xl rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--color-error)]">
              {(partsQuery.error as Error).message}
            </div>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.id}
            loading={partsQuery.isLoading}
            onRowClick={(row) => {
              const callId = row.callId ?? (row.payload as ToolPart).call_id;
              if (callId) navigate(routes.adminSherlockToolCall(callId));
            }}
            pagination={{
              page,
              totalPages,
              pageSize,
              totalItems: total,
              showCount: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              onPageChange: setPage,
              onPageSizeChange: (n) => {
                setPageSize(n);
                setPage(1);
              },
            }}
            emptyTitle="No Sherlock tool calls"
            emptyDescription="Tool invocations from any app's Sherlock chat sessions appear here once a conversation runs."
          />
        )}
      </div>
    </PageSurface>
  );
}
