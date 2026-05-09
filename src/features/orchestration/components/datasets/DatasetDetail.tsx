import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type ColumnDef } from '@/components/ui/DataTable';
import { PageSurface } from '@/components/ui/PageSurface';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { usePageMetadata } from '@/config/pageMetadata';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import { ApiError } from '@/services/api/client';
import {
  orchestrationDatasetsApi,
  type DatasetDetailResponse,
  type DatasetVersionResponse,
} from '@/services/api/orchestrationDatasets';
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

  const [dataset, setDataset] = useState<DatasetDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versionDetail, setVersionDetail] = useState<DatasetVersionResponse | null>(null);
  const [versionDetailLoading, setVersionDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DatasetVersionResponse | null>(null);
  const [deletingVersion, setDeletingVersion] = useState(false);

  const refresh = useCallback(async () => {
    if (!datasetId) return;
    setLoading(true);
    try {
      const result = await orchestrationDatasetsApi.get(datasetId);
      setDataset(result);
      // Default the sample-rows panel to the latest version. Subsequent
      // navigation through the table replaces it.
      const latest = result.latestVersion;
      if (latest) {
        setSelectedVersionId((prev) => prev ?? latest.id);
      } else {
        setSelectedVersionId(null);
        setVersionDetail(null);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to load dataset';
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fetch sample rows whenever the selected version changes. Sample rows are
  // not part of the parent ``get`` response payload — they are pulled
  // on-demand so the detail page stays cheap to render for large datasets.
  useEffect(() => {
    if (!datasetId || !selectedVersionId) {
      setVersionDetail(null);
      return;
    }
    let alive = true;
    setVersionDetailLoading(true);
    orchestrationDatasetsApi
      .getVersion(datasetId, selectedVersionId, 20)
      .then((res) => {
        if (alive) setVersionDetail(res);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load version';
        notificationService.error(msg);
      })
      .finally(() => {
        if (alive) setVersionDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [datasetId, selectedVersionId]);

  async function handleDeleteVersion() {
    if (!datasetId || !deleteTarget) return;
    setDeletingVersion(true);
    try {
      await orchestrationDatasetsApi.removeVersion(datasetId, deleteTarget.id);
      notificationService.success(
        `Deleted version v${deleteTarget.versionNumber}`,
      );
      // If the deleted version was being inspected, fall back to whatever the
      // refresh decides is the latest.
      if (selectedVersionId === deleteTarget.id) {
        setSelectedVersionId(null);
      }
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to delete version';
      notificationService.error(msg);
    } finally {
      setDeletingVersion(false);
    }
  }

  const versionColumns: ColumnDef<DatasetVersionResponse>[] = [
    {
      key: 'versionNumber',
      header: 'Version',
      render: (v) => (
        <span className="font-mono text-[var(--text-primary)]">
          v{v.versionNumber}
        </span>
      ),
    },
    {
      key: 'rowCount',
      header: 'Rows',
      render: (v) => v.rowCount.toLocaleString(),
    },
    {
      key: 'idStrategy',
      header: 'ID strategy',
      render: (v) => (
        <span className="text-[var(--text-secondary)]">
          {describeStrategy(v)}
        </span>
      ),
    },
    {
      key: 'sourceFilename',
      header: 'Source',
      render: (v) => (
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {v.sourceFilename ?? '—'}
        </span>
      ),
    },
    {
      key: 'importedAt',
      header: 'Imported',
      render: (v) => (
        <span className="text-[var(--text-secondary)]">
          {fmtDate(v.importedAt)}
        </span>
      ),
    },
    {
      key: '_actions',
      header: '',
      width: '180px',
      render: (v) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedVersionId(v.id);
            }}
            disabled={selectedVersionId === v.id}
          >
            {selectedVersionId === v.id ? 'Selected' : 'Inspect'}
          </Button>
          <Button
            size="sm"
            variant="danger-outline"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(v);
            }}
          >
            Delete
          </Button>
        </div>
      ),
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
          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
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
        back={{ to: orchestrationRoutes.datasets, label: 'Datasets' }}
        actions={
          <Button onClick={() => setUploading(true)} disabled={!dataset}>
            Upload new version
          </Button>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6 p-6">
          <section className="flex min-h-0 flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Versions
            </h3>
            <DataTable<DatasetVersionResponse>
              data={dataset?.versions ?? []}
              columns={versionColumns}
              keyExtractor={(v) => v.id}
              loading={loading}
              emptyTitle="No versions yet"
              emptyDescription="Upload a CSV to create the first version of this dataset."
            />
          </section>

          <section className="flex min-h-0 flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Sample rows
              {versionDetail
                ? ` · v${versionDetail.versionNumber}`
                : ''}
            </h3>
            {selectedVersionId ? (
              <DataTable<{ recipientId: string; payload: Record<string, unknown> }>
                data={sampleRows}
                columns={sampleColumns}
                keyExtractor={(r) => r.recipientId}
                loading={versionDetailLoading}
                emptyTitle="No sample rows"
                emptyDescription="The selected version has no rows to preview."
              />
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                Select a version to preview rows.
              </p>
            )}
          </section>
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
                setSelectedVersionId(version.id);
                void refresh();
              }}
            />
          ) : null}
        </div>
      </RightSlideOverShell>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        onClose={() => (deletingVersion ? null : setDeleteTarget(null))}
        onConfirm={handleDeleteVersion}
        title="Delete version"
        description={
          deleteTarget
            ? `Delete v${deleteTarget.versionNumber}? Workflows bound to this exact version will fail until rebound.`
            : ''
        }
        confirmLabel={deletingVersion ? 'Deleting…' : 'Delete'}
        variant="danger"
        isLoading={deletingVersion}
      />
    </>
  );
}
