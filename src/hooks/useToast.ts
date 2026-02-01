import { notificationService } from '@/services/notifications';

export function useToast() {
  return notificationService;
}
