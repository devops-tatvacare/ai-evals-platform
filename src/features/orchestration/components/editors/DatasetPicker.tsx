import { useEffect, useMemo, useState } from 'react';

import { Combobox } from '@/components/ui/Combobox';
import { Select } from '@/components/ui/Select';
import {
  InspectorEmptyState,
  InspectorField,
  InspectorSection,
} from '@/features/orchestration/components/inspector/InspectorPrimitives';
import { useCurrentAppId } from '@/hooks';
import {
  orchestrationDatasetsApi,
  type DatasetDetailResponse,
  type DatasetResponse,
} from '@/services/api/orchestrationDatasets';

interface Props {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

interface DatasetConfig {
  dataset_version_id?: string;
}

export function DatasetPicker({ value, onChange }: Props) {
  const appId = useCurrentAppId();
  const cfg = value as DatasetConfig;

  const [datasets, setDatasets] = useState<DatasetResponse[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [detail, setDetail] = useState<DatasetDetailResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void orchestrationDatasetsApi.list(appId, 'all').then((rows) => {
      if (cancelled) return;
      setDatasets(rows);
      if (cfg.dataset_version_id) {
        // Match against any version id the dataset owns — pinning an
        // older version must still pre-select. List response now carries
        // versionIds for this reason.
        const match = rows.find((d) =>
          (d.versionIds ?? []).includes(cfg.dataset_version_id!),
        );
        if (match) setSelectedDatasetId(match.id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appId, cfg.dataset_version_id]);

  useEffect(() => {
    if (!selectedDatasetId) return;
    let cancelled = false;
    void orchestrationDatasetsApi.get(selectedDatasetId).then((d) => {
      if (!cancelled) setDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDatasetId]);
  // Resolve detail from selection — null when the user clears the dataset.
  const effectiveDetail = selectedDatasetId ? detail : null;

  const datasetOptions = useMemo(
    () =>
      datasets.map((d) => ({
        value: d.id,
        label: d.name,
        description: d.latestVersion
          ? `v${d.latestVersion.versionNumber} · ${d.latestVersion.rowCount.toLocaleString()} rows`
          : 'no versions yet',
      })),
    [datasets],
  );

  const versionOptions = useMemo(() => {
    if (!effectiveDetail) return [];
    return effectiveDetail.versions.map((v) => ({
      value: v.id,
      label: `v${v.versionNumber} · ${v.rowCount.toLocaleString()} rows`,
    }));
  }, [effectiveDetail]);

  function setDataset(datasetId: string) {
    setSelectedDatasetId(datasetId);
    const ds = datasets.find((d) => d.id === datasetId);
    const versionId = ds?.latestVersion?.id ?? '';
    onChange({
      ...value,
      dataset_version_id: versionId,
    });
  }

  function setVersion(versionId: string) {
    onChange({
      ...value,
      dataset_version_id: versionId,
    });
  }

  if (datasets.length === 0) {
    return (
      <InspectorSection title="Dataset">
        <InspectorEmptyState>
          No datasets yet. Upload one from Campaigns → Datasets.
        </InspectorEmptyState>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection title="Dataset">
      <InspectorField
        label="Dataset"
        description="Datasets are fixed snapshots. The same contacts run every time."
      >
        <Combobox
          value={selectedDatasetId}
          onChange={setDataset}
          options={datasetOptions}
          placeholder="Pick an uploaded dataset…"
        />
      </InspectorField>
      {selectedDatasetId ? (
        <InspectorField label="Version">
          <Select
            value={cfg.dataset_version_id ?? ''}
            onChange={setVersion}
            options={versionOptions}
            placeholder="Pick a version…"
          />
        </InspectorField>
      ) : null}
    </InspectorSection>
  );
}
