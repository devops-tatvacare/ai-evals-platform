import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiQueryFn } from '@/services/api/queryFn';
import type {
  EmailSettingsPayload,
  NotificationSubscriptionRow,
  RecentSendRow,
} from './types';
import { emailSettingsApi } from './api';

export const emailSettingsKeys = {
  all: ['accountSettings', 'email'] as const,
  list: () => [...emailSettingsKeys.all, 'list'] as const,
  recentSends: () => [...emailSettingsKeys.all, 'recentSends'] as const,
};

export function useEmailSettings(options?: { enabled?: boolean }) {
  return useQuery<EmailSettingsPayload>({
    queryKey: emailSettingsKeys.list(),
    queryFn: () => apiQueryFn<EmailSettingsPayload>('/api/notification-subscriptions'),
    enabled: options?.enabled ?? true,
  });
}

export function useRecentSends(options?: { enabled?: boolean }) {
  return useQuery<RecentSendRow[]>({
    queryKey: emailSettingsKeys.recentSends(),
    queryFn: () =>
      apiQueryFn<RecentSendRow[]>('/api/notification-subscriptions/recent-sends?limit=50'),
    enabled: options?.enabled ?? true,
  });
}

export function useToggleSubscription() {
  const qc = useQueryClient();
  return useMutation<
    NotificationSubscriptionRow,
    Error,
    { eventType: string; isActive: boolean }
  >({
    mutationFn: ({ eventType, isActive }) =>
      emailSettingsApi.setSubscriptionActive(eventType, isActive),
    onSuccess: (updated) => {
      qc.setQueryData<EmailSettingsPayload>(emailSettingsKeys.list(), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subscriptions: prev.subscriptions.map((s) =>
            s.eventType === updated.eventType ? { ...s, ...updated } : s,
          ),
        };
      });
    },
  });
}

export function useUpdateRecipient() {
  const qc = useQueryClient();
  return useMutation<EmailSettingsPayload, Error, { recipientEmail: string }>({
    mutationFn: ({ recipientEmail }) => emailSettingsApi.setRecipient(recipientEmail),
    onSuccess: (payload) => {
      qc.setQueryData(emailSettingsKeys.list(), payload);
    },
  });
}
