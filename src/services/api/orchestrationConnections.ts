import { apiRequest } from './client';

/** Provider known to the backend `provider_specs` registry. New providers
 *  are surfaced via the schema endpoint at runtime, but the literal union
 *  catches typos in component code.
 *
 *  Mirrors backend: `bolna | wati | aisensy | lsq | msg91 | webhook`. */
export type ConnectionProvider =
  | 'bolna'
  | 'wati'
  | 'aisensy'
  | 'lsq'
  | 'msg91'
  | 'webhook';

export interface ConnectionFieldDescriptor {
  name: string;
  /** Professional UI label rendered by the form. Empty string when the
   *  backend hasn't been upgraded to ship titles yet (treat the key as a
   *  fallback). */
  title: string;
  secret: boolean;
  required: boolean;
  description: string;
  /** Provider field defaults are typed broadly because non-string fields
   *  (e.g. WATI ``channel_numbers``) declare list defaults. */
  default: unknown;
}

export interface ProviderSchema {
  provider: string;
  label: string;
  supportsWebhook: boolean;
  jsonSchema: Record<string, unknown>;
  fields: ConnectionFieldDescriptor[];
}

/** Connection config carries plaintext primitives: most fields are strings,
 *  but ``channel_numbers`` (WATI) is a string[]. Widened to ``unknown`` so
 *  future array/object fields don't force another type bump. */
export type ConnectionConfig = Record<string, string | string[]>;

export interface Connection {
  id: string;
  tenantId: string;
  appId: string;
  provider: string;
  name: string;
  active: boolean;
  lastUsedAt: string | null;
  /** Composed by the backend; null for outbound-only providers (lsq, msg91). */
  webhookUrl: string | null;
  /** Plaintext non-secret fields ONLY. Secret values are never returned. */
  configRedacted: ConnectionConfig;
  fields: ConnectionFieldDescriptor[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResponse {
  ok: boolean;
  detail: string;
}

export interface AgentVariablesResponse {
  provider: string;
  variables: string[];
  /** Soft, user-facing message when the upstream provider couldn't be
   *  queried (e.g. agent id unknown, transient transport error). The
   *  endpoint stays at HTTP 200 in that case so the picker keeps working;
   *  callers should display this inline. */
  error: string | null;
}

export interface AgentVariablesParams {
  agentId?: string;
  templateSlug?: string;
}

export interface CreateConnectionBody {
  appId: string;
  provider: string;
  name: string;
  config: ConnectionConfig;
  active?: boolean;
}

export interface UpdateConnectionBody {
  name?: string;
  active?: boolean;
  /** Partial plaintext config. Omitted secret keys preserve stored values;
   *  blank-string overwrites of secret keys are rejected by the backend. */
  config?: ConnectionConfig;
}

export interface ListConnectionsParams {
  appId?: string;
  /** When provided, restricts to one provider. Backend accepts a repeated
   *  ``provider=...`` query param so multi-provider filters work too. */
  provider?: string;
  providers?: string[];
  includeInactive?: boolean;
}

function buildListQuery(params?: ListConnectionsParams): string {
  if (!params) return '';
  const q = new URLSearchParams();
  if (params.appId) q.set('appId', params.appId);
  if (params.provider) q.append('provider', params.provider);
  if (params.providers) {
    for (const p of params.providers) q.append('provider', p);
  }
  if (params.includeInactive) q.set('includeInactive', 'true');
  const s = q.toString();
  return s ? `?${s}` : '';
}

function toAbsoluteWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  return new URL(url, window.location.origin).toString();
}

function normalizeConnection(connection: Connection): Connection {
  return {
    ...connection,
    webhookUrl: toAbsoluteWebhookUrl(connection.webhookUrl),
  };
}

export async function listConnections(params?: ListConnectionsParams): Promise<Connection[]> {
  const rows = await apiRequest<Connection[]>(`/api/orchestration/connections${buildListQuery(params)}`);
  return rows.map(normalizeConnection);
}

export async function getConnection(id: string): Promise<Connection> {
  return normalizeConnection(await apiRequest<Connection>(`/api/orchestration/connections/${id}`));
}

export async function createConnection(body: CreateConnectionBody): Promise<Connection> {
  return normalizeConnection(await apiRequest<Connection>('/api/orchestration/connections', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

export async function updateConnection(
  id: string,
  body: UpdateConnectionBody,
): Promise<Connection> {
  return normalizeConnection(await apiRequest<Connection>(`/api/orchestration/connections/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }));
}

export async function archiveConnection(id: string): Promise<void> {
  await apiRequest<void>(`/api/orchestration/connections/${id}`, { method: 'DELETE' });
}

export async function testConnection(id: string): Promise<ConnectionTestResponse> {
  return apiRequest<ConnectionTestResponse>(`/api/orchestration/connections/${id}/test`, {
    method: 'POST',
  });
}

export async function rotateWebhookToken(id: string): Promise<{ webhookUrl: string }> {
  const result = await apiRequest<{ webhookUrl: string }>(
    `/api/orchestration/connections/${id}/rotate-token`,
    { method: 'POST' },
  );
  return {
    webhookUrl: toAbsoluteWebhookUrl(result.webhookUrl) ?? result.webhookUrl,
  };
}

export async function getProviderSchema(provider: string): Promise<ProviderSchema> {
  const q = new URLSearchParams({ provider }).toString();
  return apiRequest<ProviderSchema>(`/api/orchestration/connections/schema?${q}`);
}

export async function getAgentVariables(
  connectionId: string,
  params?: AgentVariablesParams,
): Promise<AgentVariablesResponse> {
  const q = new URLSearchParams();
  if (params?.agentId) q.set('agentId', params.agentId);
  if (params?.templateSlug) q.set('templateSlug', params.templateSlug);
  const qs = q.toString();
  return apiRequest<AgentVariablesResponse>(
    `/api/orchestration/connections/${connectionId}/agent-variables${qs ? `?${qs}` : ''}`,
  );
}
