export interface NotificationDefaultRow {
  eventType: string;
  group: string;
  isRequiredForAll: boolean;
  alwaysNotifyEmails: string[];
}

export interface NotificationDefaultsResponse {
  defaults: NotificationDefaultRow[];
}

export interface AdminSubscriptionRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  eventType: string;
  group: string;
  recipientEmail: string;
  isActive: boolean;
  isRequired: boolean;
  createdAt: string;
}

export interface AdminSubscriptionList {
  rows: AdminSubscriptionRow[];
  total: number;
}

export interface AdminMailSendRow {
  id: string;
  callSite: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage: string | null;
  correlationId: string | null;
  sentAt: string;
}

export interface AdminMailSendList {
  rows: AdminMailSendRow[];
  total: number;
}

export interface AdminMailSendPreview {
  id: string;
  subject: string;
  recipient: string;
  status: string;
  sentAt: string;
  html: string | null;
  providerResponse: Record<string, unknown> | null;
  errorMessage: string | null;
}
