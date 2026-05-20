import { apiRequest } from '@/services/api/client';
import type {
  EmailSettingsPayload,
  NotificationSubscriptionRow,
} from './types';

const BASE = '/api/notification-subscriptions';

export const emailSettingsApi = {
  setSubscriptionActive: (eventType: string, isActive: boolean) =>
    apiRequest<NotificationSubscriptionRow>(
      `${BASE}/${encodeURIComponent(eventType)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      },
    ),

  setRecipient: (recipientEmail: string) =>
    apiRequest<EmailSettingsPayload>(`${BASE}/recipient`, {
      method: 'PUT',
      body: JSON.stringify({ recipientEmail }),
    }),
};
