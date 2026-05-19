/** TanStack Query hooks for typed Sherlock Parts. useSessionParts hydrates streamStore on success. */
import { useEffect } from 'react';

import { useQuery } from '@tanstack/react-query';

import { sherlockPartsApi } from '@/services/api/sherlockParts';
import type {
  ListPartsParams,
  SherlockPartListResponse,
  SherlockPartRow,
  SherlockSessionPartsResponse,
} from '@/services/api/sherlockParts';

import { useStreamStore } from '../streamStore';

export const sherlockPartsQueryKeys = {
  sessionParts: (sessionId: string, appId?: string | null) =>
    ['sherlock', 'session-parts', sessionId, appId ?? null] as const,
  partsList: (params: ListPartsParams) =>
    ['sherlock', 'parts-list', params] as const,
  partByCall: (callId: string) =>
    ['sherlock', 'parts', 'by-call', callId] as const,
};

export function useSessionParts(
  sessionId: string | null | undefined,
  appId?: string | null,
) {
  const seed = useStreamStore((s) => s.seed);
  const query = useQuery<SherlockSessionPartsResponse>({
    queryKey: sherlockPartsQueryKeys.sessionParts(sessionId ?? '', appId),
    queryFn: () =>
      sherlockPartsApi.getSessionParts(sessionId as string, appId ? { appId } : undefined),
    enabled: Boolean(sessionId),
    staleTime: 0,
  });

  useEffect(() => {
    if (!sessionId || !query.data) return;
    const parts = query.data.parts.map((row) => row.payload);
    seed(sessionId, parts, query.data.lastEventSeq);
  }, [sessionId, query.data, seed]);

  return query;
}

export function useToolCallsList(params: ListPartsParams = {}) {
  return useQuery<SherlockPartListResponse>({
    queryKey: sherlockPartsQueryKeys.partsList({ ...params, type: 'tool' }),
    queryFn: () => sherlockPartsApi.listParts({ ...params, type: 'tool' }),
  });
}

export function useToolCall(callId: string | null | undefined) {
  return useQuery<SherlockPartRow>({
    queryKey: sherlockPartsQueryKeys.partByCall(callId ?? ''),
    queryFn: () => sherlockPartsApi.getByCallId(callId as string),
    enabled: Boolean(callId),
  });
}
