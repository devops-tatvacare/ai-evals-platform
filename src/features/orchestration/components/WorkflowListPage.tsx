import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import { PageSurface } from '@/components/ui/PageSurface';
import { usePageMetadata } from '@/config/pageMetadata';
import { routes } from '@/config/routes';
import type { Workflow } from '@/features/orchestration/types';
import { ApiError } from '@/services/api/client';
import {
  archiveWorkflow,
  fireManualRun,
  listSystemWorkflows,
  listWorkflows,
} from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import { CloneSystemWorkflowDialog } from './CloneSystemWorkflowDialog';
import { CreateWorkflowDialog } from './CreateWorkflowDialog';

const APP_ID = 'inside-sales';

type SourceFilter = 'all' | 'custom' | 'platform';

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
  { id: 'platform', label: 'Platform' },
];

interface UnifiedRow extends Workflow {
  source: 'custom' | 'platform';
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function WorkflowListPage() {
  const { icon, title } = usePageMetadata('campaigns');
  const [tenantRows, setTenantRows] = useState<Workflow[]>([]);
  const [systemRows, setSystemRows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSource, setActiveSource] = useState<SourceFilter>('all');
  const [cloneSource, setCloneSource] = useState<Workflow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Workflow | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantWorkflows, systemWorkflows] = await Promise.all([
        listWorkflows({ appId: APP_ID }),
        listSystemWorkflows({ appId: APP_ID }),
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
  }, []);

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
      navigate(routes.insideSales.campaignRunDetail(run.id));
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
  }, [navigate]);

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

  const columns: ColumnDef<UnifiedRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-[var(--text-primary)]">{r.name}</span>
          {r.description ? (
            <span className="text-xs text-[var(--text-secondary)]">{r.description}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (r) =>
        r.source === 'custom' ? (
          <Badge variant="success" size="sm">Custom</Badge>
        ) : (
          <Badge variant="neutral" size="sm">Platform</Badge>
        ),
    },
    {
      key: 'workflowType',
      header: 'Type',
      render: (r) => (
        <span className="uppercase text-[var(--text-secondary)]">{r.workflowType}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.source === 'platform' ? (
          <span className="text-[var(--text-secondary)]">—</span>
        ) : r.currentPublishedVersionId ? (
          <span className="text-[var(--color-success)]">Published</span>
        ) : (
          <span className="text-[var(--text-secondary)]">Draft</span>
        ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (r) => (
        <span className="text-[var(--text-secondary)]">{fmtDate(r.updatedAt)}</span>
      ),
    },
    {
      key: '_actions',
      header: '',
      width: '300px',
      render: (r) =>
        r.source === 'platform' ? (
          <Button
            size="sm"
            variant="secondary"
            className="whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              setCloneSource(r);
            }}
          >
            Clone
          </Button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                navigate(routes.insideSales.campaignBuilder(r.id));
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!r.currentPublishedVersionId || runningId === r.id}
              title={
                !r.currentPublishedVersionId
                  ? 'Publish the workflow before running it'
                  : undefined
              }
              onClick={(e) => {
                e.stopPropagation();
                void handleRun(r);
              }}
            >
              {runningId === r.id ? 'Running…' : 'Run Now'}
            </Button>
            <Button
              size="sm"
              variant="danger-outline"
              onClick={(e) => {
                e.stopPropagation();
                setArchiveTarget(r);
              }}
            >
              Archive
            </Button>
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
          <FilterPills
            options={SOURCE_FILTERS}
            active={activeSource}
            onChange={(id) => setActiveSource(id as SourceFilter)}
          />
        )}
        actions={<Button onClick={() => setShowCreate(true)}>New Workflow</Button>}
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
                navigate(routes.insideSales.campaignBuilder(r.id));
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
            navigate(routes.insideSales.campaignBuilder(workflow.id));
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
            navigate(routes.insideSales.campaignBuilder(workflow.id));
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
    </>
  );
}
