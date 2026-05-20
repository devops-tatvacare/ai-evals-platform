import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { CHAT_SESSION_SOURCE, chatSessionsRepository } from '@/services/api/chatApi';
import type { ChatSearchHit } from '@/services/api/chatApi';
import { notificationService } from '@/services/notifications';
import type { AppId, KairaChatSession } from '@/types';

export const CHAT_SESSIONS_PAGE_SIZE = 20;

const LIST_KEY = 'chat-widget-sessions';
const SEARCH_KEY = 'chat-widget-search';

function nextOffset<T>(lastPage: T[], allPages: T[][]): number | undefined {
  return lastPage.length === CHAT_SESSIONS_PAGE_SIZE ? allPages.length * CHAT_SESSIONS_PAGE_SIZE : undefined;
}

/** Browse mode: paginated Sherlock history, newest first. */
export function useChatSessionsInfinite(appId: AppId, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [LIST_KEY, appId],
    queryFn: ({ pageParam }) =>
      chatSessionsRepository.listPage(appId, {
        source: CHAT_SESSION_SOURCE.sherlock,
        limit: CHAT_SESSIONS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled,
    staleTime: 10_000,
  });
}

/** Search mode: flat hits (title + message snippets), term matched server-side. */
export function useChatSearchInfinite(appId: AppId, query: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [SEARCH_KEY, appId, query],
    queryFn: ({ pageParam }) =>
      chatSessionsRepository.searchHits(appId, {
        source: CHAT_SESSION_SOURCE.sherlock,
        q: query,
        limit: CHAT_SESSIONS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: enabled && query.length > 0,
    staleTime: 10_000,
  });
}

export function flattenSessions(pages: KairaChatSession[][] | undefined): KairaChatSession[] {
  return pages?.flat() ?? [];
}

export function flattenHits(pages: ChatSearchHit[][] | undefined): ChatSearchHit[] {
  return pages?.flat() ?? [];
}

/** Delete a session; invalidates every browse page for the app on success. */
export function useDeleteChatSession(appId: AppId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => chatSessionsRepository.delete(appId, sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [LIST_KEY, appId] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not delete conversation: ${message}`);
    },
  });
}
