import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';

import { Badge, EmptyState, FilterPills, LoadingState, PageSurface } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { routes } from '@/config/routes';
import { usePageMetadata } from '@/config/pageMetadata';
import { timeAgo } from '@/utils/evalFormatters';

import { useToolCall, useToolCallsList } from '@/features/sherlock/queries/parts';
import type { SherlockPartRow } from '@/services/api/sherlockParts';
import type { ToolPart } from '@/features/sherlock/generated/sherlockContract';

import { ToolCallDetail } from './ToolCallDetail';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DETAIL_TITLE_ID = 'admin-sherlock-detail-title';

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

// started_at/ended_at are monotonic-clock ms; duration is their difference.
function durationMs(part: ToolPart): number | null {
  const state = part.state as { started_at?: number; ended_at?: number };
  if (typeof state.started_at !== 'number' || typeof state.ended_at !== 'number') return null;
  return state.ended_at - state.started_at;
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

function callIdOf(row: SherlockPartRow): string | null {
  return row.callId ?? (row.payload as ToolPart).call_id;
}

export function AdminSherlockPage() {
  const navigate = useNavigate();
  const { toolCallId } = useParams<{ toolCallId?: string }>();
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

  const allRows = useMemo(() => partsQuery.data?.items ?? [], [partsQuery.data]);
  const rows = useMemo(
    () => (status === 'all' ? allRows : allRows.filter((r) => statusOf(r.payload as ToolPart) === status)),
    [allRows, status],
  );
  const total = partsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // URL-driven slide-over: any link to /admin/sherlock/:callId opens it. Reuse
  // the loaded row when present; otherwise fetch by callId (cold deep-link).
  const selectedCallId = toolCallId ?? null;
  const rowInList = useMemo(
    () => allRows.find((r) => callIdOf(r) === selectedCallId) ?? null,
    [allRows, selectedCallId],
  );
  const fetched = useToolCall(selectedCallId && !rowInList ? selectedCallId : null);
  const detailRow = rowInList ?? fetched.data ?? null;
  const closeDetail = () => navigate(routes.adminSherlock);

  const columns: ColumnDef<SherlockPartRow>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'When',
        render: (row) => <span className="text-[var(--text-muted)]">{timeAgo(row.createdAt)}</span>,
      },
      {
        key: 'user',
        header: 'User',
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">{row.userLabel ?? '—'}</span>
        ),
      },
      {
        key: 'appId',
        header: 'App',
        render: (row) => <span className="text-xs text-[var(--text-secondary)]">{row.appId}</span>,
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
          <span className="text-[var(--text-secondary)]">{formatMs(durationMs(row.payload as ToolPart))}</span>
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

  const detailPart = detailRow ? (detailRow.payload as ToolPart) : null;

  return (
    <PageSurface icon={icon} title={title} subtitle="Tenant-wide Sherlock tool-call activity">
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
              const callId = callIdOf(row);
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
            emptyDescription="Tool invocations from any user's Sherlock chat sessions appear here once a conversation runs."
          />
        )}
      </div>

      <RightSlideOverShell
        isOpen={Boolean(selectedCallId)}
        onClose={closeDetail}
        labelledBy={DETAIL_TITLE_ID}
        widthClassName="w-[var(--overlay-width-md)] max-w-[92vw]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={DETAIL_TITLE_ID} className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
              {detailPart?.tool ?? 'Tool call'}
            </h2>
            {detailRow ? (
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {(detailRow.userLabel ?? detailRow.appId)} · {detailRow.appId} ·{' '}
                {new Date(detailRow.createdAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={closeDetail}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {detailRow ? (
            <ToolCallDetail row={detailRow} />
          ) : fetched.isLoading ? (
            <LoadingState />
          ) : (
            <EmptyState
              icon={icon}
              title="Tool call not found"
              description={
                (fetched.error as Error | null)?.message ??
                "It may have been removed, or you don't have access to it."
              }
            />
          )}
        </div>
      </RightSlideOverShell>
    </PageSurface>
  );
}
