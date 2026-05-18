import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import { useCurrentAppId } from '@/hooks';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import { ApiError } from '@/services/api/client';
import {
  orchestrationDatasetsApi,
  type DatasetResponse,
} from '@/services/api/orchestrationDatasets';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/stores/authStore';

import { CreateDatasetDialog } from '../datasets/CreateDatasetDialog';
import {
  canEditOrchestrationAsset,
  canManageOrchestration,
} from '@/features/orchestration/utils/access';

type VisibilityFilter = 'all' | 'private' | 'shared';

const VISIBILITY_FILTERS: Array<{ id: VisibilityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'private', label: 'Private' },
  { id: 'shared', label: 'Shared' },
];

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

interface DatasetsTabProps {
  showCreate?: boolean;
  onShowCreateChange?: (next: boolean) => void;
}

export function DatasetsTab({
  showCreate: showCreateProp,
  onShowCreateChange,
}: DatasetsTabProps = {}) {
  const appId = useCurrentAppId();
  const orchestrationRoutes = useOrchestrationRoutes();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const _canManage = canManageOrchestration(user);
  void _canManage;

  const [rows, setRows] = useState<DatasetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingLocal, setCreatingLocal] = useState(false);
  const creating = showCreateProp ?? creatingLocal;
  const setCreating = (next: boolean) => {
    if (showCreateProp === undefined) setCreatingLocal(next);
    onShowCreateChange?.(next);
  };
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<DatasetResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await orchestrationDatasetsApi.list(appId, visibility);
      setRows(result);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load datasets';
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, [appId, visibility]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await orchestrationDatasetsApi.remove(deleteTarget.id);
      notificationService.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      // 409 surfaces a workflow-binding list inside `detail`; show the
      // server's exact message so the operator knows which workflow(s)
      // are still bound.
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete dataset';
      notificationService.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<DatasetResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (d) => (
        <div className="flex flex-col gap-0.5">
          <Link
            to={orchestrationRoutes.datasetDetail(d.id)}
            className="text-[var(--text-primary)] hover:text-[var(--color-brand-accent)]"
            onClick={(e) => e.stopPropagation()}
          >
            {d.name}
          </Link>
          {d.description ? (
            <span className="line-clamp-1 text-[11px] text-[var(--text-secondary)]">
              {d.description}
            </span>
          ) : null}
          <Badge variant={d.visibility === 'shared' ? 'info' : 'neutral'} size="sm">
            {d.visibility}
          </Badge>
        </div>
      ),
    },
    {
      key: 'latestVersion',
      header: 'Latest',
      render: (d) =>
        d.latestVersion ? (
          <span className="font-mono text-[var(--text-primary)]">
            v{d.latestVersion.versionNumber}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'rowCount',
      header: 'Rows',
      render: (d) =>
        d.latestVersion ? (
          <span className="text-[var(--text-primary)]">
            {d.latestVersion.rowCount.toLocaleString()}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'importedAt',
      header: 'Imported',
      render: (d) => (
        <span className="text-[var(--text-secondary)]">
          {fmtDate(d.latestVersion?.importedAt ?? null)}
        </span>
      ),
    },
    {
      key: '_actions',
      header: '',
      width: '160px',
      render: (d) => {
        const canEdit = canEditOrchestrationAsset(user, d.createdBy);
        return (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              navigate(orchestrationRoutes.datasetDetail(d.id));
            }}
          >
            Open
          </Button>
          <Button
            size="sm"
            variant="danger-outline"
            disabled={!canEdit}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(d);
            }}
          >
            Delete
          </Button>
        </div>
      );
      },
    },
  ];

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {(rows.length > 0 || visibility !== 'all') && (
          <div className="flex items-center justify-end">
            <FilterPills
              options={VISIBILITY_FILTERS}
              active={visibility}
              onChange={(id) => setVisibility(id as VisibilityFilter)}
            />
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<DatasetResponse>
            data={rows}
            columns={columns}
            keyExtractor={(d) => d.id}
            loading={loading}
            emptyTitle="No datasets yet"
            emptyDescription="Create a cohort dataset to feed campaigns with a CSV-based recipient list."
          />
        </div>
      </div>

      <CreateDatasetDialog
        isOpen={creating}
        appId={appId}
        onClose={() => setCreating(false)}
        onCreated={(dataset) => {
          setCreating(false);
          // Land on the detail page so the operator can immediately upload
          // a first version — the create endpoint returns a dataset with
          // ``latestVersion: null`` and the detail view owns the upload UX.
          navigate(orchestrationRoutes.datasetDetail(dataset.id));
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        onConfirm={handleDelete}
        title="Delete dataset"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}" and all its versions? This cannot be undone. Workflows bound to this dataset will be blocked from running.`
            : ''
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        variant="danger"
        isLoading={deleting}
      />
    </>
  );
}
