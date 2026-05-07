import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiLogsForApp } from '@/config/routes';
import { Badge, Combobox, FilterPills } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { timeAgo } from '@/utils/evalFormatters';

import {
  useDistinctToolNames,
  useToolCalls,
} from '@/features/sherlock/queries/toolCalls';
import type { SherlockToolCallRow } from '@/services/api/sherlock';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Success' },
  { id: 'error', label: 'Error' },
  { id: 'timeout', label: 'Timeout' },
];

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  success: 'success',
  error: 'danger',
  timeout: 'warning',
};

interface SherlockTabProps {
  appId: string;
}

function formatMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Phase 15.1d — tenant + user-scoped Sherlock tool-call log. Reads from
 * `GET /api/sherlock/tool-calls`. Filters: status pills, tool-name
 * combobox (populated from a `distinct-tool-names` companion endpoint
 * so the dropdown is grounded in real data, not a hand-maintained list).
 * URL-driven via `?status=`, `?tool=`.
 *
 * Components are all platform primitives (DataTable, Combobox,
 * FilterPills, Badge). Row click navigates to the sub-route — no inline
 * expansion, no slide-over.
 */
export function SherlockTab({ appId }: SherlockTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? 'all';
  const toolName = searchParams.get('tool') ?? '';

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  const updateParam = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      setSearchParams(params);
      setPage(1);
    },
    [searchParams, setSearchParams],
  );

  const filters = useMemo(
    () => ({
      appId,
      status: status === 'all' ? null : status,
      toolName: toolName || null,
    }),
    [appId, status, toolName],
  );

  const toolCallsQuery = useToolCalls({
    page,
    pageSize,
    filters,
  });

  const toolNamesQuery = useDistinctToolNames({ appId });
  const toolNameOptions = useMemo(
    () => [
      { value: '', label: 'All tools' },
      ...(toolNamesQuery.data ?? []).map((name) => ({
        value: name,
        label: name,
      })),
    ],
    [toolNamesQuery.data],
  );

  const items = toolCallsQuery.data?.items ?? [];
  const total = toolCallsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns: ColumnDef<SherlockToolCallRow>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'When',
        render: (row) => (
          <span className="text-[var(--text-muted)]">{timeAgo(row.createdAt)}</span>
        ),
      },
      {
        key: 'toolName',
        header: 'Tool',
        render: (row) => (
          <Badge variant="info" size="sm">
            {row.toolName}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'} size="sm">
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'duration',
        header: 'Duration',
        render: (row) => (
          <span className="text-[var(--text-secondary)]">{formatMs(row.executionMs)}</span>
        ),
      },
      {
        key: 'rowCount',
        header: 'Rows',
        render: (row) => (
          <span className="text-[var(--text-secondary)]">
            {row.rowCount ?? '—'}
          </span>
        ),
      },
      {
        key: 'argsSummary',
        header: 'Arguments',
        render: (row) => (
          <span className="truncate text-xs text-[var(--text-muted)]">
            {row.argsSummary ?? '—'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterPills
          options={STATUS_PILLS}
          active={status}
          onChange={(id) => updateParam({ status: id === 'all' ? null : id })}
          size="sm"
        />
        <div className="flex shrink-0 items-center gap-2">
          <Combobox
            options={toolNameOptions}
            value={toolName}
            onChange={(v) => updateParam({ tool: v || null })}
            placeholder="All tools"
            size="sm"
            className="min-w-[220px]"
          />
        </div>
      </div>

      {toolCallsQuery.isError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center py-8">
          <div className="w-full max-w-xl rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--color-error)]">
            {(toolCallsQuery.error as Error).message}
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={items}
          keyExtractor={(row) => row.id}
          loading={toolCallsQuery.isLoading}
          onRowClick={(row) =>
            navigate(`${apiLogsForApp(appId)}/sherlock/${row.id}`)
          }
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
          emptyDescription="Tool invocations from your Sherlock chat sessions appear here once you start a conversation."
        />
      )}
    </div>
  );
}
