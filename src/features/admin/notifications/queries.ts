import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminNotificationsApi,
  type SendLogListQuery,
  type SubscriptionListQuery,
} from './api';
import type {
  AdminMailSendList,
  AdminMailSendPreview,
  AdminSubscriptionList,
  AdminSubscriptionRow,
  NotificationDefaultRow,
  NotificationDefaultsResponse,
} from './types';

export const adminNotificationsKeys = {
  all: ['admin', 'notifications'] as const,
  defaults: () => [...adminNotificationsKeys.all, 'defaults'] as const,
  subscriptions: (q: SubscriptionListQuery) =>
    [...adminNotificationsKeys.all, 'subscriptions', q] as const,
  sendLog: (q: SendLogListQuery) =>
    [...adminNotificationsKeys.all, 'send-log', q] as const,
  sendLogPreview: (id: string) =>
    [...adminNotificationsKeys.all, 'send-log', 'preview', id] as const,
};

export function useNotificationDefaults() {
  return useQuery<NotificationDefaultsResponse>({
    queryKey: adminNotificationsKeys.defaults(),
    queryFn: () => adminNotificationsApi.listDefaults(),
  });
}

export function useAdminSubscriptions(query: SubscriptionListQuery) {
  return useQuery<AdminSubscriptionList>({
    queryKey: adminNotificationsKeys.subscriptions(query),
    queryFn: () => adminNotificationsApi.listSubscriptions(query),
  });
}

export function useAdminSendLog(query: SendLogListQuery) {
  return useQuery<AdminMailSendList>({
    queryKey: adminNotificationsKeys.sendLog(query),
    queryFn: () => adminNotificationsApi.listSendLog(query),
  });
}

export function useUpdateDefault() {
  const qc = useQueryClient();
  return useMutation<
    NotificationDefaultRow,
    Error,
    { eventType: string; isRequiredForAll: boolean; alwaysNotifyEmails: string[] }
  >({
    mutationFn: ({ eventType, isRequiredForAll, alwaysNotifyEmails }) =>
      adminNotificationsApi.updateDefault(eventType, {
        isRequiredForAll,
        alwaysNotifyEmails,
      }),
    onSuccess: (updated) => {
      qc.setQueryData<NotificationDefaultsResponse>(
        adminNotificationsKeys.defaults(),
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            defaults: prev.defaults.map((d) =>
              d.eventType === updated.eventType ? { ...d, ...updated } : d,
            ),
          };
        },
      );
      // Subscription side mutates as a side effect of default changes.
      qc.invalidateQueries({ queryKey: adminNotificationsKeys.all });
    },
  });
}

export function usePatchSubscription() {
  const qc = useQueryClient();
  return useMutation<
    AdminSubscriptionRow,
    Error,
    { id: string; isActive?: boolean; isRequired?: boolean }
  >({
    mutationFn: ({ id, isActive, isRequired }) =>
      adminNotificationsApi.patchSubscription(id, { isActive, isRequired }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminNotificationsKeys.all });
    },
  });
}

export function useSendLogPreview(id: string | null) {
  return useQuery<AdminMailSendPreview>({
    queryKey: adminNotificationsKeys.sendLogPreview(id ?? ''),
    queryFn: () => adminNotificationsApi.previewSendLog(id ?? ''),
    enabled: id !== null,
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => adminNotificationsApi.deleteSubscription(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminNotificationsKeys.all });
    },
  });
}
