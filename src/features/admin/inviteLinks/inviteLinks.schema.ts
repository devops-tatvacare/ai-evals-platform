// Schema for the create-invite-link form. Server is authoritative on allowed-domains.
import { z } from 'zod';

export const EMAIL_LOCAL_PART = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_STATUS_VALUES = [
  'not_requested',
  'sent',
  'recipient_rejected',
  'not_configured',
  'failed',
] as const;

export const emailStatusSchema = z.enum(EMAIL_STATUS_VALUES);

export const createInviteSchema = z.object({
  roleId: z.string().min(1, 'Role is required'),
  label: z
    .string()
    .max(80, 'Keep the label under 80 characters')
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  expiresInHours: z.number().int().min(1).max(720),
  maxUses: z
    .number()
    .int()
    .positive('Max uses must be at least 1')
    .optional()
    .nullable(),
  recipientEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v))
    .pipe(
      z
        .string()
        .regex(EMAIL_LOCAL_PART, 'Enter a valid email address')
        .optional(),
    ),
  userName: z
    .string()
    .max(120, 'Keep the name under 120 characters')
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

export type CreateInviteFormValues = z.infer<typeof createInviteSchema>;
