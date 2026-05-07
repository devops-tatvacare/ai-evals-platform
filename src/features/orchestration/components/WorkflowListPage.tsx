import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Copy, History, Logs, Pencil, Play, Timeline } from 'lucide-react';
import { cn } from '@/utils/cn';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import { IconButton } from '@/components/ui/IconButton';
import { PageSurface } from '@/components/ui/PageSurface';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { usePageMetadata } from '@/config/pageMetadata';
import { useCurrentAppId } from '@/hooks';
import type { RunStatus, Workflow } from '@/features/orchestration/types';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import { apiLogsForApp } from '@/config/routes';
import { ApiError } from '@/services/api/client';
import { formatDateTime } from '@/utils/formatters';
import { timeAgo } from '@/utils/evalFormatters';
import {
  archiveWorkflow,
  fireManualRun,
  listSystemWorkflows,
  listWorkflows,
  updateWorkflow,
} from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/stores/authStore';
import { CloneSystemWorkflowDialog } from './CloneSystemWorkflowDialog';
import { CreateWorkflowDialog } from './CreateWorkflowDialog';
import { WorkflowRunHistoryOverlay } from './WorkflowRunHistoryOverlay';
import { RunInspectorOverlay } from './runs/RunInspectorOverlay';
import {
  canEditOrchestrationAsset,
  canManageOrchestration,
} from '@/features/orchestration/utils/access';

type SourceFilter = 'all' | 'custom' | 'platform';
type VisibilityFilter = 'all' | 'private' | 'shared';

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
  { id: 'platform', label: 'Platform' },
];

const VISIBILITY_FILTERS: Array<{ id: VisibilityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'private', label: 'Private' },
  { id: 'shared', label: 'Shared' },
];

interface UnifiedRow extends Workflow {
  source: 'custom' | 'platform';
}

/** Compact 11px inline chip — same shape as ScheduledJobsListPage's
 *  ``LastFireChip`` so list-page status pills read identical across
 *  surfaces. Uses design-system tokens (no hex literals). */
const RUN_STATUS_CHIP_CLASSES: Record<RunStatus, string> = {
  pending: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
  running: 'bg-[var(--surface-info)] text-[var(--color-info)]',
  waiting: 'bg-[var(--surface-warning)] text-[var(--color-warning)]',
  completed: 'bg-[var(--surface-success)] text-[var(--color-success)]',
  failed: 'bg-[var(--surface-error)] text-[var(--color-error)]',
  cancelled: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
};

function RunStatusChip({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        RUN_STATUS_CHIP_CLASSES[status],
      )}
    >
      {status}
    </span>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTime(d);
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return timeAgo(iso);
}

export function WorkflowListPage() {
  const { icon, title } = usePageMetadata('campaigns');
  const [tenantRows, setTenantRows] = useState<Workflow[]>([]);
  const [systemRows, setSystemRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSource, setActiveSource] = useState<SourceFilter>('all');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [cloneSource, setCloneSource] = useState<Workflow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Workflow | null>(null);
  // History modal — list of runs for one workflow.
  const [historyTarget, setHistoryTarget] = useState<Workflow | null>(null);
  // Run inspector overlay state — opens on this page (no navigation).
  // `null` when closed; `{ workflowId, runId }` while open. The same
  // RunInspectorOverlay used in the builder takes both ids; the overlay
  // itself fetches + paints recipients/actions for the selected run.
  const [inspectorState, setInspectorState] = useState<
    { workflowId: string; runId: string | null } | null
  >(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [updatingVisibilityId, setUpdatingVisibilityId] = useState<string | null>(null);
  const navigate = useNavigate();
  const appId = useCurrentAppId();
  const orchestrationRoutes = useOrchestrationRoutes();
  const user = useAuthStore((s) => s.user);
  const canManage = canManageOrchestration(user);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantWorkflows, systemWorkflows] = await Promise.all([
        listWorkflows({ appId, visibility }),
        listSystemWorkflows({ appId }),
      ]);
      setTenantRows(tenantWorkflows);
      setSystemRows(systemWorkflows);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to load campaigns';
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, [appId, visibility]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allRows = useMemo<UnifiedRow[]>(() => {
    const merged: UnifiedRow[] = [
      ...tenantRows.map((w) => ({ ...w, source: 'custom' as const })),
      ...systemRows.map((w) => ({ ...w, source: 'platform' as const })),
    ];
    merged.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return merged;
  }, [tenantRows, systemRows]);

  const visibleRows = useMemo(() => {
    if (activeSource === 'all') return allRows;
    return allRows.filter((r) => r.source === activeSource);
  }, [allRows, activeSource]);

  const handleRun = useCallback(async (workflow: Workflow) => {
    setRunningId(workflow.id);
    try {
      const run = await fireManualRun(workflow.id);
      notificationService.success(`Run started: ${run.id.slice(0, 8)}`);
      // Phase-14 follow-up — open the unified run inspector on the
      // builder rather than navigating to the legacy standalone
      // RunDetailPage. Same code path as clicking the last-run cell.
      navigate(
        `${orchestrationRoutes.campaignBuilder(workflow.id)}?run=${run.id}`,
      );
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to start run';
      notificationService.error(msg);
    } finally {
      setRunningId(null);
    }
  }, [navigate, orchestrationRoutes]);

  const handleArchive = useCallback(async () => {
    if (!archiveTarget) return;
    setArchivingId(archiveTarget.id);
    try {
      await archiveWorkflow(archiveTarget.id);
      notificationService.success(`Archived "${archiveTarget.name}"`);
      setArchiveTarget(null);
      await refresh();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to archive workflow';
      notificationService.error(msg);
    } finally {
      setArchivingId(null);
    }
  }, [archiveTarget, refresh]);

  const handleVisibilityChange = useCallback(async (workflow: Workflow, nextVisibility: 'private' | 'shared') => {
    if (workflow.visibility === nextVisibility) return;
    setUpdatingVisibilityId(workflow.id);
    try {
      await updateWorkflow(workflow.id, { visibility: nextVisibility });
      notificationService.success(
        nextVisibility === 'shared'
          ? `"${workflow.name}" is now shared`
          : `"${workflow.name}" is now private`,
      );
      await refresh();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to update workflow visibility';
      notificationService.error(msg);
    } finally {
      setUpdatingVisibilityId(null);
    }
  }, [refresh]);

  const columns: ColumnDef<UnifiedRow>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 'min-w-[260px] max-w-[420px]',
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="truncate text-[var(--text-primary)]">{r.name}</span>
          {r.description ? (
            <span className="line-clamp-1 text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
              {r.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'workflowType',
      header: 'Type',
      width: 'w-[100px]',
      render: (r) => (
        <span className="text-[var(--text-secondary)] uppercase">{r.workflowType}</span>
      ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      width: 'min-w-[180px]',
      render: (r) => {
        if (r.source === 'platform') {
          return <Badge variant="info" size="sm">Shared</Badge>;
        }
        const canEdit = canEditOrchestrationAsset(user, r.createdBy);
        return (
          <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
            <VisibilityToggle
              value={r.visibility}
              onChange={(value) => {
                void handleVisibilityChange(r, value);
              }}
              disabled={!canEdit || updatingVisibilityId === r.id}
              variant="toolbar"
            />
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-[120px]',
      render: (r) =>
        r.source === 'platform' ? (
          <Badge variant="neutral" size="sm">Platform</Badge>
        ) : r.currentPublishedVersionId ? (
          <Badge variant="success" size="sm">Published</Badge>
        ) : (
          <Badge variant="neutral" size="sm">Draft</Badge>
        ),
    },
    {
      key: 'createdBy',
      header: 'Created by',
      width: 'min-w-[160px]',
      // Phase-14 follow-up — backend resolves the creator via a join
      // on `platform.users`. System-seeded workflows have no resolvable
      // creator; render an em-dash. Email-only fallback handles the
      // case where the user row exists but has a blank display name.
      render: (r) => {
        if (r.source === 'platform') {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        const name = r.createdByName?.trim();
        const email = r.createdByEmail?.trim();
        if (!name && !email) {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        return (
          <div className="flex flex-col gap-0.5" title={email ?? undefined}>
            <span className="truncate text-[var(--text-primary)]">
              {name || email}
            </span>
            {name && email ? (
              <span className="truncate text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
                {email}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'lastRun',
      header: 'Last run',
      width: 'min-w-[170px]',
      textBehavior: 'nowrap',
      // Phase-14 follow-up — single-line "8h ago · running" with a
      // middle-dot separator. Display-only; drilling into the run is
      // exclusively via the row's [Timeline] icon in the actions column.
      render: (r) => {
        if (r.source === 'platform' || !r.lastRunAt) {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        return (
          <div
            className="flex items-center gap-1.5 whitespace-nowrap text-[var(--text-secondary)]"
            title={fmtDateTime(r.lastRunAt)}
          >
            <span className="tabular-nums">{fmtRelative(r.lastRunAt)}</span>
            {r.lastRunStatus ? (
              <>
                <span aria-hidden="true" className="text-[var(--text-muted)]">·</span>
                <RunStatusChip status={r.lastRunStatus} />
              </>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '170px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (r) =>
        r.source === 'platform' ? (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              icon={Copy}
              variant="secondary"
              size="sm"
              label="Clone"
              disabled={!canManage}
              onClick={(e) => {
                e.stopPropagation();
                setCloneSource(r);
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {(() => {
              const canEdit = canEditOrchestrationAsset(user, r.createdBy);
              return (
                <>
            {/* History — list of runs for this workflow. Opens the
             *  existing modal on the same page; no navigation. */}
            <IconButton
              icon={History}
              variant="ghost"
              size="sm"
              label="Run history"
              onClick={(e) => {
                e.stopPropagation();
                setHistoryTarget(r);
              }}
            />
            {/* Timeline — opens the run inspector overlay on this page
             *  with the most recent run pre-selected. The picker inside
             *  the overlay lets the operator switch runs. No navigation
             *  to the builder. Disabled until at least one run exists. */}
            <IconButton
              icon={Timeline}
              variant="ghost"
              size="sm"
              label="Run timeline"
              disabled={!r.lastRunId}
              onClick={(e) => {
                e.stopPropagation();
                if (!r.lastRunId) return;
                setInspectorState({ workflowId: r.id, runId: r.lastRunId });
              }}
            />
            {/* Workflow actions — deep-link to the platform Logs page,
             *  pre-filtered to this workflow's outbound action history. */}
            <IconButton
              icon={Logs}
              variant="ghost"
              size="sm"
              label="Workflow actions log"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`${apiLogsForApp(appId)}?type=workflow-actions&workflow_id=${r.id}`);
              }}
            />
            <IconButton
              icon={Pencil}
              variant="ghost"
              size="sm"
              label="Edit"
              disabled={!canEdit}
              onClick={(e) => {
                e.stopPropagation();
                navigate(orchestrationRoutes.campaignBuilder(r.id));
              }}
            />
            <IconButton
              icon={Play}
              variant="ghost"
              size="sm"
              label={
                !r.currentPublishedVersionId
                  ? 'Publish the workflow before running it'
                  : runningId === r.id
                    ? 'Starting run…'
                    : 'Run now'
              }
              disabled={!canEdit || !r.currentPublishedVersionId || runningId === r.id}
              onClick={(e) => {
                e.stopPropagation();
                void handleRun(r);
              }}
            />
            <IconButton
              icon={Archive}
              variant="danger"
              size="sm"
              label="Archive"
              disabled={!canEdit}
              onClick={(e) => {
                e.stopPropagation();
                setArchiveTarget(r);
              }}
            />
                </>
              );
            })()}
          </div>
        ),
    },
  ];

  return (
    <>
      <PageSurface
        icon={icon}
        title={title}
        filters={(
          <div className="flex flex-wrap items-center gap-3">
            <FilterPills
              options={SOURCE_FILTERS}
              active={activeSource}
              onChange={(id) => setActiveSource(id as SourceFilter)}
            />
            <FilterPills
              options={VISIBILITY_FILTERS}
              active={visibility}
              onChange={(id) => setVisibility(id as VisibilityFilter)}
            />
          </div>
        )}
        actions={canManage ? <Button onClick={() => setShowCreate(true)}>New Workflow</Button> : null}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<UnifiedRow>
            data={visibleRows}
            columns={columns}
            keyExtractor={(r) => `${r.source}:${r.id}`}
            loading={loading}
            emptyTitle="No workflows yet"
            emptyDescription="Create a custom workflow or clone a platform starter to get going."
            onRowClick={(r) => {
              if (r.source === 'custom') {
                navigate(orchestrationRoutes.campaignBuilder(r.id));
              }
            }}
          />
        </div>
      </PageSurface>
      {showCreate && (
        <CreateWorkflowDialog
          onClose={() => setShowCreate(false)}
          onCreated={(workflow) => {
            setShowCreate(false);
            navigate(orchestrationRoutes.campaignBuilder(workflow.id));
          }}
        />
      )}
      {cloneSource && (
        <CloneSystemWorkflowDialog
          sourceWorkflow={cloneSource}
          onClose={() => setCloneSource(null)}
          onCloned={(workflow) => {
            setCloneSource(null);
            void refresh();
            navigate(orchestrationRoutes.campaignBuilder(workflow.id));
          }}
          />
      )}
      <ConfirmDialog
        isOpen={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => {
          void handleArchive();
        }}
        title="Archive workflow?"
        description={
          archiveTarget
            ? `"${archiveTarget.name}" will be removed from the active campaigns list. Existing runs are preserved.`
            : ''
        }
        confirmLabel={archivingId === archiveTarget?.id ? 'Archiving…' : 'Archive'}
        variant="danger"
      />
      {historyTarget ? (
        <WorkflowRunHistoryOverlay
          workflow={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      ) : null}
      {inspectorState ? (
        // Phase-14 follow-up — same RunInspectorOverlay used in the
        // builder, mounted directly on the listing so the operator
        // sees recipients/actions without leaving the campaigns page.
        // `actionId` and `tabId` props are omitted here, so the
        // overlay falls back to its uncontrolled local state for
        // those (URL bookmarkability stays in the builder context).
        <RunInspectorOverlay
          workflowId={inspectorState.workflowId}
          runId={inspectorState.runId}
          onChangeRunId={(next) =>
            setInspectorState((prev) =>
              prev ? { ...prev, runId: next } : prev,
            )
          }
          onClose={() => setInspectorState(null)}
        />
      ) : null}
    </>
  );
}
