/**
 * Sherlock admin API surface — verified queries CRUD + instructions
 * tenant override. Both share the same `sherlock:manage_verified_queries`
 * permission gate on the backend.
 */
import { apiRequest } from './client';

export type VerifiedQuerySource = 'seed' | 'admin' | 'user_thumbs_up';

export interface VerifiedQueryRow {
  id: string;
  tenantId: string;
  appId: string;
  question: string;
  normalizedQuestion: string;
  sql: string;
  source: VerifiedQuerySource;
  enabled: boolean;
  useCount: number;
  lastUsedAt: string | null;
  verifiedAt: string;
  verifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
  isSystem: boolean;
}

export interface VerifiedQueryListResponse {
  items: VerifiedQueryRow[];
  total: number;
}

export interface VerifiedQueryCreateInput {
  appId: string;
  question: string;
  sql: string;
  enabled?: boolean;
}

export interface VerifiedQueryUpdateInput {
  question?: string;
  sql?: string;
  enabled?: boolean;
}

export interface SherlockInstructionsResponse {
  tenantOverride: string | null;
  appDefaults: Record<string, string>;
}

export async function listVerifiedQueries(params: {
  appId?: string;
  includeSystem?: boolean;
  onlyEnabled?: boolean;
}): Promise<VerifiedQueryListResponse> {
  const qs = new URLSearchParams();
  if (params.appId) qs.set('appId', params.appId);
  if (params.includeSystem === false) qs.set('includeSystem', 'false');
  if (params.onlyEnabled) qs.set('onlyEnabled', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiRequest<VerifiedQueryListResponse>(
    `/api/sherlock/verified-queries${suffix}`,
  );
}

export async function createVerifiedQuery(
  input: VerifiedQueryCreateInput,
): Promise<VerifiedQueryRow> {
  return apiRequest<VerifiedQueryRow>('/api/sherlock/verified-queries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateVerifiedQuery(
  id: string,
  input: VerifiedQueryUpdateInput,
): Promise<VerifiedQueryRow> {
  return apiRequest<VerifiedQueryRow>(
    `/api/sherlock/verified-queries/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export async function deleteVerifiedQuery(id: string): Promise<void> {
  await apiRequest<void>(`/api/sherlock/verified-queries/${id}`, {
    method: 'DELETE',
  });
}

export async function getInstructions(): Promise<SherlockInstructionsResponse> {
  return apiRequest<SherlockInstructionsResponse>(
    '/api/sherlock/verified-queries/instructions',
  );
}

export async function putInstructions(
  tenantOverride: string | null,
): Promise<SherlockInstructionsResponse> {
  return apiRequest<SherlockInstructionsResponse>(
    '/api/sherlock/verified-queries/instructions',
    {
      method: 'PUT',
      body: JSON.stringify({ tenantOverride }),
    },
  );
}
