/**
 * Saved cohort API client. Mirrors backend Pydantic models in
 * ``backend/app/schemas/orchestration_cohort.py`` — JSON is camelCase.
 */
import { apiRequest } from './client';
import type { AssetVisibility } from '@/types/settings.types';

export interface CohortFilter {
  column: string;
  op: 'eq' | 'neq' | 'gte' | 'gt' | 'lte' | 'lt' | 'in' | 'not_in' | 'contains';
  value: unknown;
}

export interface CohortVersionPayload {
  sourceRef: string;
  payloadFields?: string[];
  filters?: CohortFilter[];
  lookbackHours?: number | null;
  lookbackColumn?: string | null;
  consentGateChannel?: string | null;
}

export interface CohortVersionResponse {
  id: string;
  cohortDefinitionId: string;
  version: number;
  sourceRef: string;
  filters: CohortFilter[];
  payloadFields: string[];
  lookbackHours: number | null;
  lookbackColumn: string | null;
  consentGateChannel: string | null;
  status: 'draft' | 'published' | 'archived';
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface CohortResponse {
  id: string;
  tenantId: string;
  appId: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  visibility: AssetVisibility;
  sharedBy: string | null;
  sharedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  currentPublishedVersionId: string | null;
  latestVersion: CohortVersionResponse | null;
  /** All version ids owned by this cohort. Used by the source.saved_cohort
   *  picker to reverse-resolve which cohort owns a pinned (possibly older)
   *  version_id without an extra round-trip per row. */
  versionIds: string[];
  usedByWorkflowCount: number;
}

export interface CohortDetailResponse extends CohortResponse {
  versions: CohortVersionResponse[];
}

export interface WorkflowBindingResponse {
  workflowId: string;
  workflowName: string;
  workflowVersionId: string;
  pinnedCohortVersionId: string;
}

export interface CreateCohortBody {
  appId: string;
  slug: string;
  name: string;
  description?: string | null;
  visibility?: AssetVisibility;
  initialVersion: CohortVersionPayload;
}

export interface UpdateCohortBody {
  name?: string;
  description?: string | null;
  visibility?: AssetVisibility;
  active?: boolean;
}

const BASE = '/api/orchestration/cohorts';

export async function listCohorts(params: { appId: string }): Promise<CohortResponse[]> {
  const q = new URLSearchParams({ appId: params.appId });
  return apiRequest<CohortResponse[]>(`${BASE}?${q.toString()}`);
}

export async function getCohort(cohortId: string): Promise<CohortDetailResponse> {
  return apiRequest<CohortDetailResponse>(`${BASE}/${cohortId}`);
}

export async function createCohort(body: CreateCohortBody): Promise<CohortDetailResponse> {
  return apiRequest<CohortDetailResponse>(BASE, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateCohort(
  cohortId: string,
  body: UpdateCohortBody,
): Promise<CohortDetailResponse> {
  return apiRequest<CohortDetailResponse>(`${BASE}/${cohortId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteCohort(cohortId: string): Promise<void> {
  await apiRequest<void>(`${BASE}/${cohortId}`, { method: 'DELETE' });
}

export async function createDraftVersion(
  cohortId: string,
  payload: CohortVersionPayload,
): Promise<CohortVersionResponse> {
  return apiRequest<CohortVersionResponse>(`${BASE}/${cohortId}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function editDraftVersion(
  cohortId: string,
  versionId: string,
  payload: CohortVersionPayload,
): Promise<CohortVersionResponse> {
  return apiRequest<CohortVersionResponse>(
    `${BASE}/${cohortId}/versions/${versionId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

export async function publishVersion(
  cohortId: string,
  versionId: string,
): Promise<CohortVersionResponse> {
  return apiRequest<CohortVersionResponse>(
    `${BASE}/${cohortId}/versions/${versionId}/publish`,
    { method: 'POST' },
  );
}

export async function listUsedBy(cohortId: string): Promise<WorkflowBindingResponse[]> {
  return apiRequest<WorkflowBindingResponse[]>(`${BASE}/${cohortId}/used-by`);
}
