/**
 * Phase 15.1d — TanStack Query hooks for Sherlock observability.
 *
 * Why this lives in `features/sherlock/`: Logs is a cross-feature read
 * surface, but the Sherlock data domain owns this query keyspace. When a
 * future Sherlock-internal admin surface needs the same hook (e.g. a
 * "your recent tool calls" pane on the chat page), it imports from here
 * — the Logs page is just the first consumer.
 *
 * No polling. Sherlock isn't a live surface in the same way orchestration
 * runs are; the chat handler writes one row per tool call and a manual
 * refresh / refetchOnWindowFocus is enough. Keeping `staleTime` long so
 * navigating between Logs tabs doesn't re-fetch the same page.
 */
import { useQuery } from '@tanstack/react-query';

import {
  getToolCall,
  listDistinctToolNames,
  listToolCalls,
  type SherlockToolCallDetail,
  type SherlockToolCallListResponse,
  type ListToolCallsParams,
} from '@/services/api/sherlock';

const PAGE_SIZE_DEFAULT = 100;
const STALE_TIME_MS = 30_000;
const TOOL_NAMES_STALE_TIME_MS = 5 * 60 * 1000;

export interface ToolCallsFilters {
  appId?: string | null;
  toolName?: string | null;
  status?: string | null;
  sessionId?: string | null;
  dbSessionId?: string | null;
  since?: string | null;
  until?: string | null;
}

function normaliseFilters(filters: ToolCallsFilters | undefined): ToolCallsFilters {
  return {
    appId: filters?.appId ?? null,
    toolName: filters?.toolName ?? null,
    status: filters?.status ?? null,
    sessionId: filters?.sessionId ?? null,
    dbSessionId: filters?.dbSessionId ?? null,
    since: filters?.since ?? null,
    until: filters?.until ?? null,
  };
}

export const sherlockQueryKeys = {
  toolCalls: (page: number, pageSize: number, filters: ToolCallsFilters) =>
    ['sherlock', 'tool-calls', { page, pageSize, ...filters }] as const,
  toolCall: (id: string, appId: string | null = null) =>
    ['sherlock', 'tool-call', id, { appId }] as const,
  distinctToolNames: (appId: string | null = null) =>
    ['sherlock', 'tool-calls', 'distinct-tool-names', { appId }] as const,
};

export function useToolCalls(options?: {
  page?: number;
  pageSize?: number;
  filters?: ToolCallsFilters;
  enabled?: boolean;
}) {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? PAGE_SIZE_DEFAULT;
  const enabled = options?.enabled ?? true;
  const filters = normaliseFilters(options?.filters);
  const offset = (page - 1) * pageSize;

  return useQuery<SherlockToolCallListResponse>({
    queryKey: sherlockQueryKeys.toolCalls(page, pageSize, filters),
    queryFn: () => {
      const params: ListToolCallsParams = {
        appId: filters.appId ?? undefined,
        limit: pageSize,
        offset,
      };
      if (filters.toolName) params.toolName = filters.toolName;
      if (filters.status) params.status = filters.status;
      if (filters.sessionId) params.sessionId = filters.sessionId;
      if (filters.dbSessionId) params.dbSessionId = filters.dbSessionId;
      if (filters.since) params.since = filters.since;
      if (filters.until) params.until = filters.until;
      return listToolCalls(params);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
}

export function useToolCall(
  id: string | null | undefined,
  options?: { appId?: string | null },
) {
  const enabled = Boolean(id);
  return useQuery<SherlockToolCallDetail>({
    queryKey: enabled
      ? sherlockQueryKeys.toolCall(id as string, options?.appId ?? null)
      : (['sherlock', 'tool-call', '__disabled__'] as const),
    queryFn: () => getToolCall(id as string, { appId: options?.appId ?? undefined }),
    enabled,
    staleTime: STALE_TIME_MS,
  });
}

export function useDistinctToolNames(options?: { appId?: string | null; enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  return useQuery<string[]>({
    queryKey: sherlockQueryKeys.distinctToolNames(options?.appId ?? null),
    queryFn: () => listDistinctToolNames({ appId: options?.appId ?? undefined }),
    enabled,
    staleTime: TOOL_NAMES_STALE_TIME_MS,
  });
}
