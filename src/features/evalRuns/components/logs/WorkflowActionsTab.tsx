import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiLogsForApp } from '@/config/routes';
import { Combobox, FilterPills } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { humanize, timeAgo } from '@/utils/evalFormatters';

import { useWorkflowActions, useWorkflows } from '@/features/orchestration/queries/runs';
import { ActionStatusBadge } from '@/features/orchestration/components/runs/actionStatusBadge';
import { isRunActive, type WorkflowActionGlobalRow } from '@/features/orchestration/types';
import { useRuns } from '@/features/orchestration/queries/runs';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
  { id: 'skipped', label: 'Skipped' },
];

const CHANNEL_OPTIONS = [
  { value: '', label: 'All channels' },
  { value: 'wati', label: 'WATI' },
  { value: 'bolna', label: 'Bolna' },
  { value: 'sms', label: 'SMS' },
  { value: 'lsq', label: 'LSQ' },
  { value: 'clinical', label: 'Clinical' },
];

interface WorkflowActionsTabProps {
  appId: string;
}



/**
 * Phase 15.1b — cross-run, cross-workflow outbound action log. Reads from
 * `GET /api/orchestration/actions` (tenant-scoped, explicitly filtered to
 * the current app route). Filters: status pills, channel combobox,
 * workflow combobox. URL-driven via `?status=`, `?channel=`,
 * `?workflow_id=`.
 *
 * Components are all platform primitives (DataTable, Combobox,
 * FilterPills, ActionStatusBadge). Drill-down uses the
 * `LogsWorkflowActionPage` sub-route — no slide-over on the Logs surface
 * (overlays are reserved for the in-context builder/run-inspector flow).
 */
export function WorkflowActionsTab({ appId }: WorkflowActionsTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? 'all';
  const channel = searchParams.get('channel') ?? '';
  const workflowId = searchParams.get('workflow_id') ?? '';

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
      channel: channel || null,
      workflowId: workflowId || null,
    }),
    [appId, status, channel, workflowId],
  );

  const liveRunsQuery = useRuns({
    page: 1,
    pageSize: 1,
    filters: { appId },
  });
  const hasActiveRun = (liveRunsQuery.data?.runs ?? []).some((run) => isRunActive(run.status));

  const actionsQuery = useWorkflowActions({
    page,
    pageSize,
    filters,
    livePoll: hasActiveRun,
  });

  const workflowsQuery = useWorkflows({ appId });
  const workflowOptions = useMemo(
    () => [
      { value: '', label: 'All workflows' },
      ...(workflowsQuery.data ?? []).map((wf) => ({
        value: wf.id,
        label: wf.name,
        meta: wf.workflowType,
      })),
    ],
    [workflowsQuery.data],
  );

  const items = actionsQuery.data?.items ?? [];
  const total = actionsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns: ColumnDef<WorkflowActionGlobalRow>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'When',
        render: (row) => (
          <span className="text-[var(--text-muted)]">{timeAgo(row.createdAt)}</span>
        ),
      },
      {
        key: 'workflow',
        header: 'Workflow',
        render: (row) => (
          <span className="truncate text-[var(--text-primary)]">
            {row.workflowName ?? row.workflowId.slice(0, 8)}
          </span>
        ),
      },
      {
        key: 'channel',
        header: 'Channel',
        render: (row) => (
          <span className="text-[var(--text-secondary)] capitalize">{row.channel}</span>
        ),
      },
      {
        key: 'actionType',
        header: 'Action',
        render: (row) => (
          <span className="text-[var(--text-secondary)]">{humanize(row.actionType)}</span>
        ),
      },
      {
        key: 'recipientId',
        header: 'Recipient',
        render: (row) => (
          <span className="font-mono text-xs text-[var(--text-secondary)]">{row.recipientId}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <ActionStatusBadge status={row.status} />,
      },
      {
        key: 'providerCorrelationId',
        header: 'Provider id',
        render: (row) =>
          row.providerCorrelationId ? (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {row.providerCorrelationId.slice(0, 16)}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
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
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={(v) => updateParam({ channel: v || null })}
            placeholder="All channels"
            size="sm"
            className="min-w-[150px]"
          />
          <Combobox
            options={workflowOptions}
            value={workflowId}
            onChange={(v) => updateParam({ workflow_id: v || null })}
            placeholder="All workflows"
            size="sm"
            className="min-w-[200px]"
          />
        </div>
      </div>

      {actionsQuery.isError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center py-8">
          <div className="w-full max-w-xl rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--color-error)]">
            {(actionsQuery.error as Error).message}
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={items}
          keyExtractor={(row) => row.id}
          loading={actionsQuery.isLoading}
          onRowClick={(row) =>
            navigate(
              `${apiLogsForApp(appId)}/workflow-actions/${row.id}?run=${row.runId}`,
            )
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
          emptyTitle="No workflow actions"
          emptyDescription="Once a workflow runs and dispatches messages, calls, or stage updates, those actions appear here."
        />
      )}
    </div>
  );
}
