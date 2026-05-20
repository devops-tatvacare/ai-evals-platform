import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, Inbox, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSurface } from '@/components/ui/PageSurface';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import {
  RowActionsMenu,
  type RowAction,
} from '@/components/ui/RowActionsMenu';
import { usePageMetadata } from '@/config/pageMetadata';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import {
  datasetQueryKeys,
  useDataset,
  useDatasetVersion,
  useDeleteDatasetVersion,
} from '@/features/orchestration/queries/datasets';
import { ApiError } from '@/services/api/client';
import { type DatasetVersionResponse } from '@/services/api/orchestrationDatasets';
import { notificationService } from '@/services/notifications';

import { DatasetUploadForm } from './DatasetUploadForm';

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function describeStrategy(version: DatasetVersionResponse): string {
  if (version.idStrategy === 'uuid') return 'Auto-generated UUIDs';
  return version.idColumn ? `Column: ${version.idColumn}` : 'Column';
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function DatasetDetail() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const { icon } = usePageMetadata('datasetDetail');
  const orchestrationRoutes = useOrchestrationRoutes();

  const qc = useQueryClient();
  const { data: dataset, isLoading: loading } = useDataset(datasetId);
  const versions = useMemo(() => dataset?.versions ?? [], [dataset]);
  const hasVersions = versions.length > 0;
  const latestVersionId = dataset?.latestVersion?.id ?? null;

  const [uploading, setUploading] = useState(false);
  const [userSelectedVersionId, setUserSelectedVersionId] =
    useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatasetVersionResponse | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const selectedVersionId = useMemo(() => {
    if (!hasVersions) return null;
    if (
      userSelectedVersionId &&
      versions.some((v) => v.id === userSelectedVersionId)
    ) {
      return userSelectedVersionId;
    }
    return latestVersionId;
  }, [hasVersions, userSelectedVersionId, versions, latestVersionId]);

  const { data: versionDetail, isLoading: versionDetailLoading } =
    useDatasetVersion(datasetId, selectedVersionId, 20);

  const deleteVersion = useDeleteDatasetVersion(datasetId ?? '');

  async function handleDeleteVersion() {
    if (!datasetId || !deleteTarget) return;
    try {
      await deleteVersion.mutateAsync(deleteTarget.id);
      notificationService.success(
        `Deleted version v${deleteTarget.versionNumber}`,
      );
      if (selectedVersionId === deleteTarget.id) {
        setUserSelectedVersionId(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete version';
      notificationService.error(msg);
    }
  }

  const versionColumns: ColumnDef<DatasetVersionResponse>[] = [
    {
      key: 'versionNumber',
      header: 'Version',
      width: 'w-[90px]',
      render: (v) => (
        <span className="font-mono text-[var(--text-primary)]">
          v{v.versionNumber}
        </span>
      ),
    },
    {
      key: 'rowCount',
      header: 'Rows',
      width: 'w-[100px]',
      render: (v) => (
        <span className="tabular-nums text-[var(--text-primary)]">
          {v.rowCount.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'idStrategy',
      header: 'ID strategy',
      width: 'min-w-[180px]',
      render: (v) => (
        <span className="text-[var(--text-secondary)]">
          {describeStrategy(v)}
        </span>
      ),
    },
    {
      key: 'sourceFilename',
      header: 'Source',
      width: 'min-w-[200px]',
      render: (v) => (
        <span className="truncate font-mono text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
          {v.sourceFilename ?? '—'}
        </span>
      ),
    },
    {
      key: 'importedAt',
      header: 'Imported',
      width: 'min-w-[160px]',
      textBehavior: 'nowrap',
      render: (v) => (
        <span className="text-[var(--text-secondary)]">
          {fmtDate(v.importedAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: 'w-[80px]',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (v) => {
        const actions: RowAction[] = [
          {
            id: 'inspect',
            icon: Eye,
            label: selectedVersionId === v.id ? 'Selected' : 'Inspect',
            disabled: selectedVersionId === v.id,
            onClick: () => setUserSelectedVersionId(v.id),
          },
          {
            id: 'delete',
            icon: Trash2,
            label: 'Delete',
            danger: true,
            onClick: () => setDeleteTarget(v),
          },
        ];
        return (
          <div className="flex items-center justify-end">
            <RowActionsMenu
              actions={actions}
              open={openMenuId === v.id}
              onOpenChange={(open) => setOpenMenuId(open ? v.id : null)}
            />
          </div>
        );
      },
    },
  ];

  const sampleColumns = useMemo<
    ColumnDef<{ recipientId: string; payload: Record<string, unknown> }>[]
  >(() => {
    const cols = versionDetail?.schemaDescriptor.columns ?? [];
    const result: ColumnDef<{
      recipientId: string;
      payload: Record<string, unknown>;
    }>[] = [
      {
        key: '__recipientId',
        header: 'Recipient ID',
        render: (row) => (
          <span className="font-mono text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
            {row.recipientId}
          </span>
        ),
      },
    ];
    cols.forEach((c) => {
      result.push({
        key: c.name,
        header: c.name,
        render: (row) => (
          <span className="text-[var(--text-primary)]">
            {renderCell(row.payload[c.name])}
          </span>
        ),
      });
    });
    return result;
  }, [versionDetail]);

  const sampleRows = versionDetail?.sampleRows ?? [];

  return (
    <>
      <PageSurface
        icon={icon}
        title={dataset?.name ?? (loading ? 'Loading…' : 'Dataset')}
        subtitle={dataset?.description ?? undefined}
        back={{ to: orchestrationRoutes.datasetsTab, label: 'Datasets' }}
        actions={
          <Button onClick={() => setUploading(true)} disabled={!dataset}>
            Upload new version
          </Button>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6 p-6">
          {!loading && dataset && !hasVersions ? (
            <EmptyState
              fill
              icon={Inbox}
              title="No versions yet"
              description="Upload a CSV to create the first version of this dataset."
              action={{
                label: 'Upload CSV',
                onClick: () => setUploading(true),
              }}
            />
          ) : (
            <>
              <section className="flex min-h-0 flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Versions
                </h3>
                <DataTable<DatasetVersionResponse>
                  data={versions}
                  columns={versionColumns}
                  keyExtractor={(v) => v.id}
                  loading={loading}
                  emptyTitle="No versions yet"
                  emptyDescription="Upload a CSV to create the first version of this dataset."
                />
              </section>

              {hasVersions && selectedVersionId ? (
                <section className="flex min-h-0 flex-col gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Sample rows
                    {versionDetail ? ` · v${versionDetail.versionNumber}` : ''}
                  </h3>
                  <DataTable<{ recipientId: string; payload: Record<string, unknown> }>
                    data={sampleRows}
                    columns={sampleColumns}
                    keyExtractor={(r) => r.recipientId}
                    loading={versionDetailLoading}
                    emptyTitle="No sample rows"
                    emptyDescription="The selected version has no rows to preview."
                  />
                </section>
              ) : null}
            </>
          )}
        </div>
      </PageSurface>

      <RightSlideOverShell isOpen={uploading} onClose={() => setUploading(false)}>
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Upload new version
          </h2>
          <button
            type="button"
            onClick={() => setUploading(false)}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {uploading && datasetId ? (
            <DatasetUploadForm
              datasetId={datasetId}
              onClose={() => setUploading(false)}
              onUploaded={(version) => {
                setUploading(false);
                setUserSelectedVersionId(version.id);
                if (datasetId) {
                  qc.invalidateQueries({
                    queryKey: datasetQueryKeys.detail(datasetId),
                  });
                  qc.invalidateQueries({
                    queryKey: ['orchestration', 'datasets', 'list'],
                  });
                }
              }}
            />
          ) : null}
        </div>
      </RightSlideOverShell>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() =>
          deleteVersion.isPending ? null : setDeleteTarget(null)
        }
        onConfirm={handleDeleteVersion}
        title="Delete version"
        description={
          deleteTarget
            ? `Delete v${deleteTarget.versionNumber}? Workflows bound to this exact version will fail until rebound.`
            : ''
        }
        confirmLabel={deleteVersion.isPending ? 'Deleting…' : 'Delete'}
        variant="danger"
        isLoading={deleteVersion.isPending}
      />
    </>
  );
}
