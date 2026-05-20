import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Trash2 } from 'lucide-react';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { FilterPills } from '@/components/ui/FilterPills';
import {
  RowActionsMenu,
  type RowAction,
} from '@/components/ui/RowActionsMenu';
import { VisibilityBadge } from '@/components/ui/VisibilityBadge';
import { useCurrentAppId } from '@/hooks';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import {
  useDatasets,
  useDeleteDataset,
} from '@/features/orchestration/queries/datasets';
import { ApiError } from '@/services/api/client';
import { type DatasetResponse } from '@/services/api/orchestrationDatasets';
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

  const [creatingLocal, setCreatingLocal] = useState(false);
  const creating = showCreateProp ?? creatingLocal;
  const setCreating = (next: boolean) => {
    if (showCreateProp === undefined) setCreatingLocal(next);
    onShowCreateChange?.(next);
  };
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<DatasetResponse | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useDatasets(appId, visibility);
  const deleteDataset = useDeleteDataset();

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDataset.mutateAsync(deleteTarget.id);
      notificationService.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete dataset';
      notificationService.error(msg);
    }
  }

  const columns: ColumnDef<DatasetResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 'min-w-[260px] max-w-[420px]',
      render: (d) => (
        <div className="flex flex-col gap-0.5">
          <Link
            to={orchestrationRoutes.datasetDetail(d.id)}
            className="truncate text-[var(--text-primary)] hover:text-[var(--color-brand-accent)]"
            onClick={(e) => e.stopPropagation()}
          >
            {d.name}
          </Link>
          {d.description ? (
            <span className="line-clamp-1 text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
              {d.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'visibility',
      header: 'Visibility',
      width: 'w-[120px]',
      render: (d) => <VisibilityBadge visibility={d.visibility} compact />,
    },
    {
      key: 'latestVersion',
      header: 'Latest',
      width: 'w-[90px]',
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
      width: 'w-[100px]',
      render: (d) =>
        d.latestVersion ? (
          <span className="tabular-nums text-[var(--text-primary)]">
            {d.latestVersion.rowCount.toLocaleString()}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'importedAt',
      header: 'Imported',
      width: 'min-w-[160px]',
      textBehavior: 'nowrap',
      render: (d) => (
        <span className="text-[var(--text-secondary)]">
          {fmtDate(d.latestVersion?.importedAt ?? null)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'w-[80px]',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (d) => {
        const canEdit = canEditOrchestrationAsset(user, d.createdBy);
        const actions: RowAction[] = [
          {
            id: 'open',
            icon: ExternalLink,
            label: 'Open',
            onClick: () => navigate(orchestrationRoutes.datasetDetail(d.id)),
          },
          {
            id: 'delete',
            icon: Trash2,
            label: 'Delete',
            danger: true,
            disabled: !canEdit,
            onClick: () => setDeleteTarget(d),
          },
        ];
        return (
          <div className="flex items-center justify-end">
            <RowActionsMenu
              actions={actions}
              open={openMenuId === d.id}
              onOpenChange={(open) => setOpenMenuId(open ? d.id : null)}
            />
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
            loading={isLoading}
            emptyTitle="No datasets yet"
            emptyDescription="Create a cohort dataset to feed campaigns with a CSV-based recipient list."
            onRowClick={(d) => navigate(orchestrationRoutes.datasetDetail(d.id))}
          />
        </div>
      </div>

      <CreateDatasetDialog
        isOpen={creating}
        appId={appId}
        onClose={() => setCreating(false)}
        onCreated={(dataset) => {
          setCreating(false);
          navigate(orchestrationRoutes.datasetDetail(dataset.id));
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() =>
          deleteDataset.isPending ? null : setDeleteTarget(null)
        }
        onConfirm={handleDelete}
        title="Delete dataset"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}" and all its versions? This cannot be undone. Workflows bound to this dataset will be blocked from running.`
            : ''
        }
        confirmLabel={deleteDataset.isPending ? 'Deleting…' : 'Delete'}
        variant="danger"
        isLoading={deleteDataset.isPending}
      />
    </>
  );
}
