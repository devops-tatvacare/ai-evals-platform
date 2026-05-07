import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiLogsForApp } from '@/config/routes';
import { Combobox, FilterPills } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { timeAgo } from '@/utils/evalFormatters';

import { useRuns, useWorkflows } from '@/features/orchestration/queries/runs';
import { RunStatusBadge } from '@/features/orchestration/components/runs/runStatusBadge';
import type { RunStatus, WorkflowRun } from '@/features/orchestration/types';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const STATUS_PILLS = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

interface WorkflowRunsTabProps {
  appId: string;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Phase 15.1c — cross-workflow run list. Reads from `GET /api/orchestration/runs`
 * (tenant + app-scoped via auth.app_access). Filters: status pills,
 * workflow combobox. Row click navigates to the sub-route page
 * `/<app>/logs/workflow-runs/:runId` — no overlay, no inline drill.
 */
export function WorkflowRunsTab({ appId }: WorkflowRunsTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? 'all';
  const workflowId = searchParams.get('workflow_id') ?? '';

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  const updateParam = (next: Record<string, string | null>) => {
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
  };

  const filters = useMemo(
    () => ({
      appId,
      status: status === 'all' ? null : (status as RunStatus),
      workflowId: workflowId || null,
    }),
    [appId, status, workflowId],
  );

  const runsQuery = useRuns({ page, pageSize, filters });
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

  const workflowNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const wf of workflowsQuery.data ?? []) map.set(wf.id, wf.name);
    return map;
  }, [workflowsQuery.data]);

  const runs = runsQuery.data?.runs ?? [];
  const total = runsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const columns: ColumnDef<WorkflowRun>[] = useMemo(
    () => [
      {
        key: 'startedAt',
        header: 'Started',
        render: (row) => (
          <span className="text-[var(--text-muted)]">
            {row.startedAt ? timeAgo(row.startedAt) : timeAgo(row.createdAt)}
          </span>
        ),
      },
      {
        key: 'workflow',
        header: 'Workflow',
        render: (row) => (
          <span className="truncate text-[var(--text-primary)]">
            {workflowNameById.get(row.workflowId) ?? row.workflowId.slice(0, 8)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <RunStatusBadge status={row.status} />,
      },
      {
        key: 'cohort',
        header: 'Cohort',
        render: (row) => <span>{row.cohortSizeAtEntry}</span>,
      },
      {
        key: 'duration',
        header: 'Duration',
        render: (row) => (
          <span className="font-mono text-xs">
            {formatDuration(row.startedAt, row.completedAt)}
          </span>
        ),
      },
      {
        key: 'triggeredBy',
        header: 'Triggered by',
        render: (row) => (
          <span className="text-[var(--text-secondary)] capitalize">{row.triggeredBy}</span>
        ),
      },
      {
        key: 'runId',
        header: 'Run id',
        render: (row) => (
          <span className="font-mono text-xs text-[var(--text-muted)]">{row.id.slice(-8)}</span>
        ),
      },
    ],
    [workflowNameById],
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
        <Combobox
          options={workflowOptions}
          value={workflowId}
          onChange={(v) => updateParam({ workflow_id: v || null })}
          placeholder="All workflows"
          size="sm"
          className="min-w-[220px]"
        />
      </div>

      {runsQuery.isError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center py-8">
          <div className="w-full max-w-xl rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--color-error)]">
            {(runsQuery.error as Error).message}
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={runs}
          keyExtractor={(row) => row.id}
          loading={runsQuery.isLoading}
          onRowClick={(row) =>
            navigate(`${apiLogsForApp(appId)}/workflow-runs/${row.id}`)
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
          emptyTitle="No workflow runs"
          emptyDescription="Run a workflow from the campaigns page to populate this view."
        />
      )}
    </div>
  );
}
