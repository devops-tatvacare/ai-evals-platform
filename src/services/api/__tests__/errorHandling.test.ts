import { describe, expect, it } from 'vitest';

import {
  isNetworkError,
  isServerError,
  parseApiErrorResponse,
  summarizeApiErrorDetail,
} from '@/services/api/errorHandling';
import { ApiError } from '@/services/api/apiError';

describe('summarizeApiErrorDetail', () => {
  it('keeps node and field context when summarizing structured detail arrays', () => {
    expect(
      summarizeApiErrorDetail([
        { node_id: 'node-1', field: 'template_name', message: 'Required' },
        { loc: ['body', 'name'], msg: 'Bad value' },
      ]),
    ).toBe('node-1 · template_name: Required\nbody.name: Bad value');
  });
});

describe('parseApiErrorResponse', () => {
  it('preserves the raw JSON body while extracting a readable detail summary', () => {
    const parsed = parseApiErrorResponse(
      JSON.stringify({
        detail: [{ node_id: 'node-1', field: 'template_name', message: 'Required' }],
      }),
    );

    expect(parsed.detail).toBe('node-1 · template_name: Required');
    expect(parsed.errorData).toEqual({
      detail: [{ node_id: 'node-1', field: 'template_name', message: 'Required' }],
    });
  });
});

describe('isNetworkError', () => {
  it('flags fetch transport failures across browser message variants', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource'))).toBe(true);
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
  });

  it('does not flag HTTP errors or unrelated failures', () => {
    expect(isNetworkError(new ApiError(500, 'boom'))).toBe(false);
    expect(isNetworkError(new TypeError('cannot read properties of undefined'))).toBe(false);
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(false);
    expect(isNetworkError('nope')).toBe(false);
  });
});

describe('isServerError', () => {
  it('flags 5xx ApiErrors', () => {
    expect(isServerError(new ApiError(500, 'x'))).toBe(true);
    expect(isServerError(new ApiError(503, 'x'))).toBe(true);
  });

  it('does not flag 4xx, transport, or non-ApiError', () => {
    expect(isServerError(new ApiError(401, 'x'))).toBe(false);
    expect(isServerError(new ApiError(429, 'x'))).toBe(false);
    expect(isServerError(new TypeError('Failed to fetch'))).toBe(false);
  });
});
