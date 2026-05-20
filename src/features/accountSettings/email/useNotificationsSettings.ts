import { useCallback, useMemo } from 'react';
import {
  useEmailSettings,
  useRecentSends,
  useToggleSubscription,
  useUpdateRecipient,
} from './queries';
import {
  buildNotificationsFormValue,
  saveNotifications,
  type NotificationsFormValue,
} from './notificationsForm';

/**
 * Bridges the notification subscription queries into the shared
 * `useSettingsForm` scheme: exposes the server-projected slice for
 * `buildStoreValues` and a `save` that the page calls from `onSaveApp`.
 * Fetches only when the app surfaces the tab (`enabled`).
 */
export function useNotificationsSettings(enabled: boolean) {
  const emailQuery = useEmailSettings({ enabled });
  const recentQuery = useRecentSends({ enabled });
  const toggleMutation = useToggleSubscription();
  const recipientMutation = useUpdateRecipient();

  const storeValue = useMemo(
    () => buildNotificationsFormValue(emailQuery.data),
    [emailQuery.data],
  );

  const save = useCallback(
    (form: NotificationsFormValue, store: NotificationsFormValue) =>
      saveNotifications(form, store, {
        setActive: (eventType, isActive) =>
          toggleMutation.mutateAsync({ eventType, isActive }),
        setRecipient: (recipientEmail) =>
          recipientMutation.mutateAsync({ recipientEmail }),
      }),
    [toggleMutation, recipientMutation],
  );

  return {
    enabled,
    storeValue,
    save,
    loading: emailQuery.isLoading,
    isError: emailQuery.isError,
    recentSends: recentQuery.data ?? [],
    recentLoading: recentQuery.isLoading,
    recentError: recentQuery.isError,
  };
}

export type NotificationsSettings = ReturnType<typeof useNotificationsSettings>;
