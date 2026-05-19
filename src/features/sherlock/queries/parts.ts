/**
 * TanStack Query hooks for the typed Sherlock Part stream.
 *
 * Server-shaped reads only. The live Part buffer is held in
 * src/features/sherlock/streamStore.ts and never duplicated here.
 *
 * useSessionParts hydrates the streamStore on success — that one bridge is
 * the contract: TQ owns the snapshot fetch, the store owns the live buffer.
 */
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
  sessionParts: (sessionId: string) =>
    ['sherlock', 'session-parts', sessionId] as const,
  partsList: (params: ListPartsParams) =>
    ['sherlock', 'parts-list', params] as const,
  partByCall: (callId: string) =>
    ['sherlock', 'parts', 'by-call', callId] as const,
};

export function useSessionParts(sessionId: string | null | undefined) {
  const seed = useStreamStore((s) => s.seed);
  const query = useQuery<SherlockSessionPartsResponse>({
    queryKey: sherlockPartsQueryKeys.sessionParts(sessionId ?? ''),
    queryFn: () => sherlockPartsApi.getSessionParts(sessionId as string),
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
