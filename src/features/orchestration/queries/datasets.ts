/**
 * Cohort-dataset TanStack Query hooks. Server data via the shared apiRequest
 * client (auth-retry flow stays in effect). Mirrors the shape of cohorts.ts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  orchestrationDatasetsApi,
  type DatasetDetailResponse,
  type DatasetFormatResponse,
  type DatasetResponse,
  type DatasetVersionResponse,
} from '@/services/api/orchestrationDatasets';

type VisibilityFilter = 'all' | 'private' | 'shared';

export const datasetQueryKeys = {
  list: (appId: string, visibility: VisibilityFilter) =>
    ['orchestration', 'datasets', 'list', appId, visibility] as const,
  detail: (datasetId: string) =>
    ['orchestration', 'datasets', 'detail', datasetId] as const,
  version: (datasetId: string, versionId: string, sampleRows: number) =>
    [
      'orchestration',
      'datasets',
      'version',
      datasetId,
      versionId,
      sampleRows,
    ] as const,
  formats: () => ['orchestration', 'datasets', 'formats'] as const,
};

export function useDatasetFormats() {
  return useQuery<DatasetFormatResponse[]>({
    queryKey: datasetQueryKeys.formats(),
    queryFn: () => orchestrationDatasetsApi.formats(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDatasets(
  appId: string | null | undefined,
  visibility: VisibilityFilter = 'all',
) {
  return useQuery<DatasetResponse[]>({
    queryKey: datasetQueryKeys.list(appId ?? '', visibility),
    queryFn: () => orchestrationDatasetsApi.list(appId as string, visibility),
    enabled: Boolean(appId),
  });
}

export function useDataset(datasetId: string | null | undefined) {
  return useQuery<DatasetDetailResponse>({
    queryKey: datasetQueryKeys.detail(datasetId ?? ''),
    queryFn: () => orchestrationDatasetsApi.get(datasetId as string),
    enabled: Boolean(datasetId),
  });
}

export function useDatasetVersion(
  datasetId: string | null | undefined,
  versionId: string | null | undefined,
  sampleRows = 20,
) {
  return useQuery<DatasetVersionResponse>({
    queryKey: datasetQueryKeys.version(
      datasetId ?? '',
      versionId ?? '',
      sampleRows,
    ),
    queryFn: () =>
      orchestrationDatasetsApi.getVersion(
        datasetId as string,
        versionId as string,
        sampleRows,
      ),
    enabled: Boolean(datasetId && versionId),
  });
}

export function useDeleteDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (datasetId: string) => orchestrationDatasetsApi.remove(datasetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orchestration', 'datasets'] });
    },
  });
}

export function useDeleteDatasetVersion(datasetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      orchestrationDatasetsApi.removeVersion(datasetId, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: datasetQueryKeys.detail(datasetId) });
      qc.invalidateQueries({ queryKey: ['orchestration', 'datasets', 'list'] });
    },
  });
}
