/** Sherlock typed Part stream API client. */
import { apiRequest } from './client';
import type { SherlockPart } from '@/features/sherlock/generated/sherlockContract';

export interface SherlockPartRow {
  id: string;
  seq: number;
  type: string;
  callId: string | null;
  chatSessionId: string;
  appId: string;
  userId: string;
  userLabel: string | null;
  payload: SherlockPart;
  createdAt: string;
}

export interface SherlockPartListResponse {
  items: SherlockPartRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface SherlockSessionPartsResponse {
  sessionId: string;
  lastEventSeq: number;
  parts: SherlockPartRow[];
}

export interface ListPartsParams {
  appId?: string;
  type?: string;
  callId?: string;
  sessionId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

function buildListQuery(params: ListPartsParams | undefined): string {
  if (!params) return '';
  const q = new URLSearchParams();
  if (params.appId) q.set('appId', params.appId);
  if (params.type) q.set('type', params.type);
  if (params.callId) q.set('callId', params.callId);
  if (params.sessionId) q.set('sessionId', params.sessionId);
  if (params.since) q.set('since', params.since);
  if (params.until) q.set('until', params.until);
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  if (params.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export const sherlockPartsApi = {
  listParts(params?: ListPartsParams): Promise<SherlockPartListResponse> {
    return apiRequest<SherlockPartListResponse>(
      `/api/sherlock/parts${buildListQuery(params)}`,
    );
  },

  getByCallId(callId: string): Promise<SherlockPartRow> {
    return apiRequest<SherlockPartRow>(
      `/api/sherlock/parts/by-call/${encodeURIComponent(callId)}`,
    );
  },

  getSessionParts(
    sessionId: string,
    options?: { appId?: string; afterSeq?: number },
  ): Promise<SherlockSessionPartsResponse> {
    const q = new URLSearchParams();
    if (options?.appId) q.set('appId', options.appId);
    if (options?.afterSeq !== undefined) {
      q.set('afterSeq', String(options.afterSeq));
    }
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiRequest<SherlockSessionPartsResponse>(
      `/api/sherlock/sessions/${encodeURIComponent(sessionId)}/parts${suffix}`,
    );
  },
};
