import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import { PageSurface } from '@/components/ui/PageSurface';
import { usePageMetadata } from '@/config/pageMetadata';
import { useCurrentAppId } from '@/hooks';
import { listRuns, listWorkflows } from '@/services/api/orchestration';
import type { RunStatus, Workflow, WorkflowRun } from '@/features/orchestration/types';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import { formatDateTime } from '@/utils/formatters';
import { timeAgo } from '@/utils/evalFormatters';

const STATUS_FILTERS: { id: 'all' | RunStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const STATUS_VARIANT: Record<RunStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

function fmtAbsolute(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDateTime(d);
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return timeAgo(iso);
}

function fmtDuration(started: string | null, completed: string | null): string {
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

/** Cross-campaign run log for the current app. Filters by status.
 *  Click row → run detail. App context comes from ``useCurrentAppId`` so
 *  the same component mounts under every app that hosts orchestration.
 *
 *  Column shape mirrors ``WorkflowRunHistoryOverlay`` so a tenant scanning
 *  runs across campaigns sees the same status / duration / trigger /
 *  cohort columns whether they entered via the per-workflow history
 *  overlay or this top-level view. */
export function CampaignRunsPage() {
  const navigate = useNavigate();
  const appId = useCurrentAppId();
  const orchestrationRoutes = useOrchestrationRoutes();
  const { icon } = usePageMetadata('runs');
  const [rows, setRows] = useState<WorkflowRun[]>([]);
  const [workflowsById, setWorkflowsById] = useState<Record<string, Workflow>>({});
  const [activeStatus, setActiveStatus] = useState<'all' | RunStatus>('all');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [runsResponse, workflows] = await Promise.all([
        listRuns({
          status: activeStatus === 'all' ? undefined : activeStatus,
          limit: 100,
        }),
        listWorkflows({ appId }),
      ]);
      setRows(runsResponse.runs);
      const map: Record<string, Workflow> = {};
      for (const w of workflows) map[w.id] = w;
      setWorkflowsById(map);
    } finally {
      setLoading(false);
    }
  }, [activeStatus, appId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns = useMemo<ColumnDef<WorkflowRun>[]>(
    () => [
      {
        key: 'started',
        header: 'Started',
        width: 'min-w-[190px]',
        textBehavior: 'nowrap',
        render: (r) => (
          <div>
            <div className="tabular-nums text-[var(--text-primary)]">
              {fmtRelative(r.createdAt)}
            </div>
            <div
              className="text-[length:var(--text-table-header)] text-[var(--text-muted)]"
              title={fmtAbsolute(r.createdAt)}
            >
              {fmtAbsolute(r.createdAt)}
            </div>
          </div>
        ),
      },
      {
        key: 'workflow',
        header: 'Campaign',
        width: 'min-w-[200px]',
        render: (r) => (
          <span className="text-[var(--text-primary)]">
            {workflowsById[r.workflowId]?.name ?? r.workflowId.slice(0, 8)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 'w-[130px]',
        render: (r) => (
          <Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'} size="sm">
            {r.status}
          </Badge>
        ),
      },
      {
        key: 'duration',
        header: 'Duration',
        width: 'w-[100px]',
        render: (r) => (
          <span className="tabular-nums text-[var(--text-secondary)]">
            {fmtDuration(r.startedAt, r.completedAt)}
          </span>
        ),
      },
      {
        key: 'trigger',
        header: 'Trigger',
        width: 'w-[110px]',
        render: (r) => (
          <span className="text-[var(--text-secondary)]">{r.triggeredBy}</span>
        ),
      },
      {
        key: 'cohort',
        header: 'Cohort',
        width: 'w-[80px]',
        cellClassName: 'text-right tabular-nums',
        headerClassName: 'text-right',
        render: (r) => r.cohortSizeAtEntry,
      },
      {
        key: 'run-id',
        header: 'Run ID',
        width: 'min-w-[160px]',
        render: (r) => (
          <span
            className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]"
            title={r.id}
          >
            {r.id.slice(0, 8)}…{r.id.slice(-4)}
          </span>
        ),
      },
      {
        key: 'error',
        header: 'Error',
        width: 'min-w-[240px]',
        render: (r) =>
          r.error ? (
            <span
              className="line-clamp-2 text-[var(--color-error)]"
              title={r.error}
            >
              {r.error}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">—</span>
          ),
      },
    ],
    [workflowsById],
  );

  return (
    <PageSurface
      icon={icon}
      title="Campaign Runs"
      filters={(
        <FilterPills
          options={STATUS_FILTERS}
          active={activeStatus}
          onChange={(id) => setActiveStatus(id as 'all' | RunStatus)}
        />
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <DataTable
          data={rows}
          columns={columns}
          keyExtractor={(r) => r.id}
          loading={loading}
          emptyTitle="No campaign runs yet"
          emptyDescription="Trigger a campaign or wait for a scheduled run to fire."
          minWidth="980px"
          onRowClick={(r) => navigate(orchestrationRoutes.campaignRunDetail(r.id))}
        />
      </div>
    </PageSurface>
  );
}
