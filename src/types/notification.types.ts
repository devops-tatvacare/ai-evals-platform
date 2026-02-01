export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading';
export type NotificationPriority = 'low' | 'normal' | 'high';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title?: string;
  message: string;
  duration?: number;
  dismissible: boolean;
  priority: NotificationPriority;
  action?: NotificationAction;
  onDismiss?: () => void;
}
