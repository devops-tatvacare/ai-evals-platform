import type { BadgeVariant } from '@/components/ui';

export const ACTION_STATUS_VARIANT: Record<string, BadgeVariant> = {
  success: 'success',
  pending: 'neutral',
  failed: 'danger',
  retryable: 'warning',
  skipped: 'neutral',
};

export const ACTION_STATUS_LABEL: Record<string, string> = {
  success: 'Success',
  pending: 'Pending',
  failed: 'Failed',
  retryable: 'Retryable',
  skipped: 'Skipped',
};
