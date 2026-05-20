import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/apiError';
import { describeAuthError } from '../authErrors';

describe('describeAuthError', () => {
  it('maps 401 to fixed credential copy, ignoring backend detail', () => {
    expect(describeAuthError(new ApiError(401, 'Invalid credentials'))).toBe(
      'Incorrect email or password.',
    );
  });

  it('maps an unreachable server (fetch TypeError) to connection copy', () => {
    expect(describeAuthError(new TypeError('Failed to fetch'))).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it('maps 5xx to a server-error message', () => {
    expect(describeAuthError(new ApiError(500, 'boom'))).toBe(
      'Something went wrong on our end. Please try again in a moment.',
    );
  });

  it('surfaces the backend detail verbatim for other 4xx', () => {
    expect(describeAuthError(new ApiError(403, 'Account disabled'))).toBe('Account disabled');
    expect(
      describeAuthError(
        new ApiError(400, 'An account with this email already exists. Please sign in instead.'),
      ),
    ).toBe('An account with this email already exists. Please sign in instead.');
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(describeAuthError(new Error('weird'))).toBe('Something went wrong. Please try again.');
    expect(describeAuthError('nope')).toBe('Something went wrong. Please try again.');
  });
});
