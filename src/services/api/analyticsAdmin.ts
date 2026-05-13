/**
 * Analytics admin API client — Phase 3 mirror->fact mapping admin endpoints.
 *
 * Backend lives at `backend/app/routes/analytics_admin.py`. Routes are gated
 * on the `analytics:admin` permission; the hooks below are paired with a
 * <RequirePermission action="analytics:admin"> guard at the page level.
 */
import { apiRequest } from './client';

export interface MappingStateRow {
  id: string;
  appId: string;
  sourceTable: string;
  targetFact: string;
  activityType: string;
  enabled: boolean;
  disabledAt: string | null;
  disabledByUserId: string | null;
  disabledReason: string | null;
  updatedAt: string;
}

export interface MappingStateListResponse {
  mappings: MappingStateRow[];
}

export interface DisableMappingRequest {
  reason: string;
}

export function listMappings(): Promise<MappingStateListResponse> {
  return apiRequest<MappingStateListResponse>('/api/admin/analytics/mappings');
}

export function disableMapping(
  mappingId: string,
  body: DisableMappingRequest,
): Promise<MappingStateRow> {
  return apiRequest<MappingStateRow>(
    `/api/admin/analytics/mappings/${mappingId}/disable`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export function enableMapping(mappingId: string): Promise<MappingStateRow> {
  return apiRequest<MappingStateRow>(
    `/api/admin/analytics/mappings/${mappingId}/enable`,
    { method: 'POST' },
  );
}
