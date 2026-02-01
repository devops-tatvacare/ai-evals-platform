import { toast, type ExternalToast } from 'sonner';
import type { AppNotification } from '@/types';
import { generateId } from '@/utils';

const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 2000;

function isDuplicate(message: string): boolean {
  const now = Date.now();
  const lastTime = recentMessages.get(message);
  
  if (lastTime && now - lastTime < DEDUP_WINDOW_MS) {
    return true;
  }
  
  recentMessages.set(message, now);
  // Cleanup old entries
  for (const [msg, time] of recentMessages) {
    if (now - time > DEDUP_WINDOW_MS) {
      recentMessages.delete(msg);
    }
  }
  
  return false;
}

function getToastOptions(notification: AppNotification): ExternalToast {
  const options: ExternalToast = {
    id: notification.id,
    duration: notification.duration ?? (notification.type === 'error' ? 6000 : 4000),
    dismissible: notification.dismissible,
  };

  if (notification.action) {
    options.action = {
      label: notification.action.label,
      onClick: notification.action.onClick,
    };
  }

  if (notification.onDismiss) {
    options.onDismiss = notification.onDismiss;
  }

  return options;
}

export const notificationService = {
  notify(params: Omit<AppNotification, 'id'>): string | null {
    if (isDuplicate(params.message)) {
      return null;
    }

    const notification: AppNotification = {
      ...params,
      id: generateId(),
    };

    const options = getToastOptions(notification);
    const content = notification.title 
      ? notification.message 
      : notification.message;
    
    const title = notification.title;

    switch (notification.type) {
      case 'success':
        toast.success(title ?? content, title ? { ...options, description: content } : options);
        break;
      case 'error':
        toast.error(title ?? content, title ? { ...options, description: content } : options);
        break;
      case 'warning':
        toast.warning(title ?? content, title ? { ...options, description: content } : options);
        break;
      case 'info':
        toast.info(title ?? content, title ? { ...options, description: content } : options);
        break;
      case 'loading':
        toast.loading(title ?? content, title ? { ...options, description: content } : options);
        break;
    }

    return notification.id;
  },

  success(message: string, title?: string): string | null {
    return this.notify({ type: 'success', message, title, dismissible: true, priority: 'normal' });
  },

  error(message: string, title?: string): string | null {
    return this.notify({ type: 'error', message, title, dismissible: true, priority: 'high' });
  },

  warning(message: string, title?: string): string | null {
    return this.notify({ type: 'warning', message, title, dismissible: true, priority: 'normal' });
  },

  info(message: string, title?: string): string | null {
    return this.notify({ type: 'info', message, title, dismissible: true, priority: 'low' });
  },

  loading(message: string): string | null {
    return this.notify({ type: 'loading', message, dismissible: false, priority: 'normal' });
  },

  dismiss(id: string): void {
    toast.dismiss(id);
  },

  dismissAll(): void {
    toast.dismiss();
  },

  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string }
  ): void {
    toast.promise(promise, messages);
  },
};
