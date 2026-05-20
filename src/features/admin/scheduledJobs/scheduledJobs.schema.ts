/**
 * Zod schemas for the notifications section.
 *
 * Cap matches the backend constraint (10 extra recipients). Email regex is
 * conservative — local-part / domain shapes the server already accepts.
 */
import { z } from 'zod';

export const MAX_NOTIFY_EMAILS = 10;

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export const notifyEmailSchema = z
  .string()
  .trim()
  .regex(EMAIL_REGEX);

export const notifyEmailsListSchema = z
  .array(notifyEmailSchema)
  .max(MAX_NOTIFY_EMAILS);

export type NotifyEmailsList = z.infer<typeof notifyEmailsListSchema>;

export function isAllowedDomain(email: string, allowedDomains: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const lower = email.trim().toLowerCase();
  return allowedDomains.some((d) => {
    const suffix = (d.startsWith('@') ? d : `@${d}`).toLowerCase();
    return lower.endsWith(suffix);
  });
}
