import { apiRequest } from './client';

/**
 * Signal-definitions admin API (Phase 11C). CRUD over
 * `analytics.signal_definition` — the tenant-editable signal derivation
 * config. The operator's own-tenant rows are editable; `isSystemTemplate`
 * rows are the read-only platform defaults a tenant row would shadow.
 */
export interface SignalDefinitionRow {
  id: string;
  tenantId: string;
  appId: string;
  signalSet: string;
  strategy: string;
  sourceSurface: string;
  definition: Record<string, unknown>;
  enabled: boolean;
  isSystemTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignalDefinitionListResponse {
  definitions: SignalDefinitionRow[];
}

export interface CreateSignalDefinitionRequest {
  appId: string;
  signalSet: string;
  strategy: string;
  sourceSurface: string;
  definition: Record<string, unknown>;
  enabled: boolean;
}

export interface UpdateSignalDefinitionRequest {
  sourceSurface?: string;
  definition?: Record<string, unknown>;
  enabled?: boolean;
}

export function listSignalDefinitions(): Promise<SignalDefinitionListResponse> {
  return apiRequest<SignalDefinitionListResponse>(
    '/api/admin/analytics/signal-definitions',
  );
}

export function createSignalDefinition(
  body: CreateSignalDefinitionRequest,
): Promise<SignalDefinitionRow> {
  return apiRequest<SignalDefinitionRow>(
    '/api/admin/analytics/signal-definitions',
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function updateSignalDefinition(
  id: string,
  body: UpdateSignalDefinitionRequest,
): Promise<SignalDefinitionRow> {
  return apiRequest<SignalDefinitionRow>(
    `/api/admin/analytics/signal-definitions/${id}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export function deleteSignalDefinition(id: string): Promise<void> {
  return apiRequest<void>(`/api/admin/analytics/signal-definitions/${id}`, {
    method: 'DELETE',
  });
}
