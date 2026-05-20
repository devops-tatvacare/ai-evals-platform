/**
 * Wire shapes for `/api/notification-subscriptions/*`.
 * Mirrors the Pydantic schemas in `backend/app/schemas/notification_subscription.py`.
 */

export interface NotificationSubscriptionRow {
  eventType: string;
  group: string;
  isActive: boolean;
  isRequired: boolean;
  recipientEmail: string;
}

export interface EmailSettingsPayload {
  recipientEmail: string;
  subscriptions: NotificationSubscriptionRow[];
}

export interface RecentSendRow {
  id: string;
  callSite: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage: string | null;
  sentAt: string;
}
