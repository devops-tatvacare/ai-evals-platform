import { ApiError } from '@/services/api/apiError';
import { isNetworkError, isServerError } from '@/services/api/errorHandling';

/**
 * Maps a login/signup failure to user-facing copy by error *category* rather
 * than string-matching messages, so an unreachable backend or a 500 no longer
 * reads as "incorrect password".
 */
export function describeAuthError(err: unknown): string {
  if (isNetworkError(err)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (isServerError(err)) {
    return 'Something went wrong on our end. Please try again in a moment.';
  }
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Incorrect email or password.';
    // Other 4xx (disabled, domain not allowed, rate-limited, duplicate email)
    // carry a stable backend detail — surface it verbatim.
    if (err.message) return err.message;
  }
  return 'Something went wrong. Please try again.';
}
