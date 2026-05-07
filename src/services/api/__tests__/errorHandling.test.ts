import { describe, expect, it } from 'vitest';

import {
  parseApiErrorResponse,
  summarizeApiErrorDetail,
} from '@/services/api/errorHandling';

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
