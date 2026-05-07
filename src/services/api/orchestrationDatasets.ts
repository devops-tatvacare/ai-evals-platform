/**
 * Cohort dataset API client (orchestration).
 *
 * Mirrors backend Pydantic models from
 * ``backend/app/api/v1/orchestration/datasets.py`` — JSON is camelCase,
 * Python is snake_case.
 *
 * The list/get endpoints surface a *redacted* view: secrets never round-trip
 * (datasets carry no secrets, but the convention matches connections).
 * `uploadVersion` builds its own multipart payload because the backend's
 * upload endpoint expects extra form fields (``id_strategy``, ``id_column``)
 * alongside the file — the generic ``apiUpload`` helper in ``client.ts`` only
 * speaks single-field uploads.
 */

import { ApiError, apiRequest } from './client';
import { parseApiErrorResponse } from './errorHandling';
import { useAuthStore } from '@/stores/authStore';
import type { AssetVisibility } from '@/types/settings.types';

const API_BASE = '';

export interface DatasetSchemaColumn {
  name: string;
  type: 'integer' | 'number' | 'boolean' | 'datetime' | 'string';
  sampleValues: string[];
  distinctCount: number;
}

export interface DatasetSchemaDescriptor {
  columns: DatasetSchemaColumn[];
  rowCount: number;
}

export interface DatasetVersionResponse {
  id: string;
  datasetId: string;
  versionNumber: number;
  sourceType: 'csv' | 'gsheet' | 'api';
  sourceFilename: string | null;
  sourceByteSize: number | null;
  rowCount: number;
  idStrategy: 'column' | 'uuid';
  idColumn: string | null;
  schemaDescriptor: DatasetSchemaDescriptor;
  importedBy: string;
  importedAt: string;
  sampleRows?: Array<{ recipientId: string; payload: Record<string, unknown> }>;
}

export interface DatasetResponse {
  id: string;
  tenantId: string;
  appId: string;
  name: string;
  description: string | null;
  createdBy: string;
  visibility: AssetVisibility;
  sharedBy: string | null;
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersion: DatasetVersionResponse | null;
}

export interface DatasetDetailResponse extends DatasetResponse {
  versions: DatasetVersionResponse[];
}

export interface CreateDatasetBody {
  appId: string;
  name: string;
  description?: string | null;
  visibility?: AssetVisibility;
}

export interface UpdateDatasetBody {
  name?: string;
  description?: string | null;
  visibility?: AssetVisibility;
}

function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Multipart upload that carries extra form fields. Mirrors the auth-retry
 * flow in `apiUpload` from `client.ts`; the difference is the FormData is
 * built by the caller (so ``id_strategy``/``id_column`` ride alongside the
 * file).
 */
async function uploadDatasetVersionRequest(
  datasetId: string,
  fd: FormData,
): Promise<DatasetVersionResponse> {
  const url = `${API_BASE}/api/orchestration/datasets/${datasetId}/versions`;
  const doFetch = () =>
    fetch(url, {
      method: 'POST',
      body: fd,
      headers: getAuthHeaders(),
      credentials: 'include',
    });

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await useAuthStore.getState().refreshToken();
    if (!refreshed) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
    response = await doFetch();
    if (response.status === 401) {
      useAuthStore.getState().logout();
      throw new ApiError(401, 'Session expired');
    }
  }

  if (!response.ok) {
    const text = await response.text();
    const { errorData, detail } = parseApiErrorResponse(text);
    throw new ApiError(
      response.status,
      detail || `Upload failed: ${response.statusText}`,
      errorData,
    );
  }

  return response.json();
}

export const orchestrationDatasetsApi = {
  list: (appId: string, visibility: 'all' | 'private' | 'shared' = 'all') =>
    apiRequest<DatasetResponse[]>(
      `/api/orchestration/datasets?appId=${encodeURIComponent(appId)}&visibility=${encodeURIComponent(visibility)}`,
    ),
  get: (id: string) =>
    apiRequest<DatasetDetailResponse>(`/api/orchestration/datasets/${id}`),
  create: (body: CreateDatasetBody) =>
    apiRequest<DatasetResponse>('/api/orchestration/datasets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpdateDatasetBody) =>
    apiRequest<DatasetDetailResponse>(`/api/orchestration/datasets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    apiRequest<void>(`/api/orchestration/datasets/${id}`, { method: 'DELETE' }),
  uploadVersion: (
    datasetId: string,
    file: File,
    idStrategy: 'column' | 'uuid',
    idColumn?: string,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('id_strategy', idStrategy);
    if (idStrategy === 'column' && idColumn) {
      fd.append('id_column', idColumn);
    }
    return uploadDatasetVersionRequest(datasetId, fd);
  },
  getVersion: (datasetId: string, versionId: string, sampleRows = 0) =>
    apiRequest<DatasetVersionResponse>(
      `/api/orchestration/datasets/${datasetId}/versions/${versionId}?sampleRows=${sampleRows}`,
    ),
  removeVersion: (datasetId: string, versionId: string) =>
    apiRequest<void>(
      `/api/orchestration/datasets/${datasetId}/versions/${versionId}`,
      { method: 'DELETE' },
    ),
};
