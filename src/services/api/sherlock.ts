/**
 * Phase 15.1d — Sherlock observability client (read-only).
 *
 * Powers the platform Logs page's "Sherlock" tab + the
 * `/<app>/logs/sherlock/:toolCallId` sub-route page. Backend resolves
 * tenant + user scope via the bearer token; the FE only specifies
 * filters and pagination.
 */
import { apiRequest } from './client';

export interface SherlockToolCallRow {
  id: string;
  sessionId: string | null;
  dbSessionId: string | null;
  appId: string;
  toolName: string;
  status: string;
  errorMessage: string | null;
  executionMs: number | null;
  rowCount: number | null;
  llmModel: string | null;
  cacheHit: boolean | null;
  argsSummary: string | null;
  createdAt: string;
}

export interface SherlockToolCallDetail {
  id: string;
  sessionId: string | null;
  dbSessionId: string | null;
  appId: string;
  toolName: string;
  status: string;
  errorMessage: string | null;
  executionMs: number | null;
  rowCount: number | null;
  llmModel: string | null;
  llmTokensIn: number | null;
  llmTokensOut: number | null;
  cacheHit: boolean | null;
  arguments: Record<string, unknown> | null;
  generatedSql: string | null;
  validatedSql: string | null;
  createdAt: string;
}

export interface SherlockToolCallListResponse {
  items: SherlockToolCallRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListToolCallsParams {
  appId?: string;
  toolName?: string;
  status?: string;
  sessionId?: string;
  dbSessionId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export async function listToolCalls(
  params?: ListToolCallsParams,
): Promise<SherlockToolCallListResponse> {
  const q = new URLSearchParams();
  if (params?.appId) q.set('appId', params.appId);
  if (params?.toolName) q.set('toolName', params.toolName);
  if (params?.status) q.set('status', params.status);
  if (params?.sessionId) q.set('sessionId', params.sessionId);
  if (params?.dbSessionId) q.set('dbSessionId', params.dbSessionId);
  if (params?.since) q.set('since', params.since);
  if (params?.until) q.set('until', params.until);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest<SherlockToolCallListResponse>(
    `/api/sherlock/tool-calls${qs ? `?${qs}` : ''}`,
  );
}

export async function getToolCall(
  id: string,
  params?: { appId?: string },
): Promise<SherlockToolCallDetail> {
  const q = new URLSearchParams();
  if (params?.appId) q.set('appId', params.appId);
  const qs = q.toString();
  return apiRequest<SherlockToolCallDetail>(
    `/api/sherlock/tool-calls/${id}${qs ? `?${qs}` : ''}`,
  );
}

export async function listDistinctToolNames(params?: { appId?: string }): Promise<string[]> {
  const q = new URLSearchParams();
  if (params?.appId) q.set('appId', params.appId);
  const qs = q.toString();
  return apiRequest<string[]>(
    `/api/sherlock/tool-calls/distinct-tool-names${qs ? `?${qs}` : ''}`,
  );
}
