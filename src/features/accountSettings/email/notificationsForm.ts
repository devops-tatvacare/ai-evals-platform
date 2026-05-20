import { EMAIL_REGEX } from './emailSettings.schema';
import { emailSettingsCopy } from './emailSettings.copy';
import type { EmailSettingsPayload } from './types';

/** A single event the user can opt in/out of, carried inside the settings form. */
export interface NotificationToggle {
  eventType: string;
  group: string;
  isActive: boolean;
  isRequired: boolean;
}

/** Notification slice of the settings form — diffed by `useSettingsForm`. */
export interface NotificationsFormValue {
  recipientEmail: string;
  toggles: NotificationToggle[];
}

export const EMPTY_NOTIFICATIONS: NotificationsFormValue = {
  recipientEmail: '',
  toggles: [],
};

/** Project the server payload into the form slice; order is preserved so the
 *  `JSON.stringify` dirty-diff in `useSettingsForm` stays stable. */
export function buildNotificationsFormValue(
  payload: EmailSettingsPayload | undefined,
): NotificationsFormValue {
  if (!payload) return EMPTY_NOTIFICATIONS;
  return {
    recipientEmail: payload.recipientEmail,
    toggles: payload.subscriptions.map((s) => ({
      eventType: s.eventType,
      group: s.group,
      isActive: s.isActive,
      isRequired: s.isRequired,
    })),
  };
}

export interface NotificationsMutators {
  setActive: (eventType: string, isActive: boolean) => Promise<unknown>;
  setRecipient: (recipientEmail: string) => Promise<unknown>;
}

/** Persist only what changed between the saved (`store`) and edited (`form`)
 *  slices. Throws on an invalid recipient so the save bar surfaces the error
 *  instead of writing a bad address. */
export async function saveNotifications(
  form: NotificationsFormValue,
  store: NotificationsFormValue,
  mutators: NotificationsMutators,
): Promise<void> {
  const nextRecipient = form.recipientEmail.trim();
  const recipientChanged = nextRecipient !== store.recipientEmail.trim();
  if (recipientChanged && !EMAIL_REGEX.test(nextRecipient)) {
    throw new Error(emailSettingsCopy.error.recipientInvalid);
  }

  for (const toggle of form.toggles) {
    const prev = store.toggles.find((t) => t.eventType === toggle.eventType);
    // Skip admin-locked rows so a required flip set server-side mid-edit never sends a doomed PUT.
    if (prev && !prev.isRequired && prev.isActive !== toggle.isActive) {
      await mutators.setActive(toggle.eventType, toggle.isActive);
    }
  }

  if (recipientChanged) {
    await mutators.setRecipient(nextRecipient);
  }
}
