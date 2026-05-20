import { z } from 'zod';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const recipientSchema = z.object({
  recipientEmail: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .regex(EMAIL_REGEX, 'invalid_format'),
});

export type RecipientFormValues = z.infer<typeof recipientSchema>;
