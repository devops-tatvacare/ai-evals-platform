import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/apiError';
import { friendlyErrorMessage } from '@/services/evaluators/evaluatorExecutor';

describe('friendlyErrorMessage', () => {
  it('maps a genuine transport failure to the connection message via the shared predicate', () => {
    expect(friendlyErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Network error: Unable to reach AI service. Please check your internet connection.',
    );
  });

  it('does not mislabel a 5xx that merely mentions "network" as a connection problem', () => {
    expect(friendlyErrorMessage(new ApiError(500, 'network upstream pool exhausted'))).toBe(
      'network upstream pool exhausted',
    );
  });

  it('still recognises cancellation', () => {
    expect(friendlyErrorMessage(new Error('The operation was aborted'))).toBe(
      'Operation was cancelled.',
    );
  });
});
