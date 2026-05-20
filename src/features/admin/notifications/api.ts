import { apiDownload, apiRequest } from '@/services/api/client';
import type {
  AdminMailSendList,
  AdminMailSendPreview,
  AdminSubscriptionList,
  AdminSubscriptionRow,
  NotificationDefaultRow,
  NotificationDefaultsResponse,
} from './types';

const BASE = '/api/admin/notifications';

export interface SubscriptionListQuery {
  eventType?: string;
  userId?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SendLogListQuery {
  status?: string;
  callSite?: string;
  recipient?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

// Wire param keys are snake_case (platform convention — FastAPI query params
// are not camel-aliased like request bodies). These mappers are the single
// source of the send-log + subscriptions query strings.
export function subscriptionParams(query: SubscriptionListQuery): string {
  return buildQuery({
    event_type: query.eventType,
    user_id: query.userId,
    is_active: query.isActive,
    page: query.page,
    page_size: query.pageSize,
  });
}

export function sendLogParams(query: SendLogListQuery, withPaging = true): string {
  return buildQuery({
    status: query.status,
    call_site: query.callSite,
    recipient: query.recipient,
    from_date: query.fromDate,
    to_date: query.toDate,
    ...(withPaging ? { page: query.page, page_size: query.pageSize } : {}),
  });
}

export const adminNotificationsApi = {
  listDefaults: () => apiRequest<NotificationDefaultsResponse>(`${BASE}/defaults`),

  updateDefault: (
    eventType: string,
    body: { isRequiredForAll: boolean; alwaysNotifyEmails: string[] },
  ) =>
    apiRequest<NotificationDefaultRow>(
      `${BASE}/defaults/${encodeURIComponent(eventType)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  listSubscriptions: (query: SubscriptionListQuery = {}) =>
    apiRequest<AdminSubscriptionList>(
      `${BASE}/subscriptions${subscriptionParams(query)}`,
    ),

  patchSubscription: (
    id: string,
    body: { isActive?: boolean; isRequired?: boolean },
  ) =>
    apiRequest<AdminSubscriptionRow>(
      `${BASE}/subscriptions/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  deleteSubscription: (id: string) =>
    apiRequest<void>(`${BASE}/subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listSendLog: (query: SendLogListQuery = {}) =>
    apiRequest<AdminMailSendList>(`${BASE}/send-log${sendLogParams(query)}`),

  previewSendLog: (id: string) =>
    apiRequest<AdminMailSendPreview>(
      `${BASE}/send-log/${encodeURIComponent(id)}/preview`,
    ),

  exportSendLogCsv: (query: SendLogListQuery = {}) =>
    apiDownload(`${BASE}/send-log.csv${sendLogParams(query, false)}`),
};
