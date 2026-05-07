import { describe, expect, it } from 'vitest';

import { ApiError } from '@/services/api/client';
import {
  decodeApiError,
  decodeApiErrorBody,
  fieldErrorsFromZodIssues,
  summarizeApiErrorBody,
} from '../errorDecoder';

describe('decodeApiErrorBody', () => {
  it('returns fieldErrors when detail is the orchestration array shape', () => {
    const out = decodeApiErrorBody({
      detail: [
        { node_id: 'n1', field: 'template_name', message: 'is required' },
        { node_id: 'n2', field: 'channel_number', message: 'must be E.164' },
      ],
    });
    expect(out.kind).toBe('fieldErrors');
    if (out.kind === 'fieldErrors') {
      expect(out.items).toHaveLength(2);
      expect(out.items[0]).toEqual({
        nodeId: 'n1',
        field: 'template_name',
        message: 'is required',
      });
    }
  });

  it('coerces FastAPI-style { loc, msg } items into field errors', () => {
    const out = decodeApiErrorBody({
      detail: [
        { loc: ['body', 'name'], msg: 'field required', type: 'value_error.missing' },
      ],
    });
    expect(out.kind).toBe('fieldErrors');
    if (out.kind === 'fieldErrors') {
      expect(out.items[0].field).toBe('body.name');
      expect(out.items[0].message).toBe('field required');
    }
  });

  it('returns message when detail is a plain string', () => {
    const out = decodeApiErrorBody({ detail: 'not authenticated' });
    expect(out).toEqual({ kind: 'message', message: 'not authenticated' });
  });

  it('returns message when raw is a bare string', () => {
    const out = decodeApiErrorBody('boom');
    expect(out).toEqual({ kind: 'message', message: 'boom' });
  });

  it('returns unknown for shapeless payloads', () => {
    const out = decodeApiErrorBody({ random: 'shape' });
    expect(out.kind).toBe('unknown');
  });

  it('handles a single-object detail by wrapping in fieldErrors', () => {
    const out = decodeApiErrorBody({
      detail: { node_id: 'n1', field: 'x', message: 'bad' },
    });
    expect(out.kind).toBe('fieldErrors');
  });
});

describe('decodeApiError', () => {
  it('pulls structured fieldErrors off ApiError.data', () => {
    const err = new ApiError(
      422,
      'unused',
      { detail: [{ node_id: 'n1', field: 'f', message: 'oops' }] },
    );
    const body = decodeApiError(err);
    expect(body.kind).toBe('fieldErrors');
  });

  it('falls back to ApiError.message when data is unrecognised', () => {
    const err = new ApiError(500, 'server fell over', { weird: true });
    const body = decodeApiError(err);
    expect(body).toEqual({ kind: 'message', message: 'server fell over' });
  });

  it('handles plain Error', () => {
    const body = decodeApiError(new Error('network down'));
    expect(body).toEqual({ kind: 'message', message: 'network down' });
  });

  it('handles non-Error throwables as unknown', () => {
    const body = decodeApiError(42);
    expect(body.kind).toBe('unknown');
  });
});

describe('summarizeApiErrorBody', () => {
  it('uses the message verbatim when kind is message', () => {
    expect(
      summarizeApiErrorBody({ kind: 'message', message: 'nope' }, 'fallback'),
    ).toBe('nope');
  });

  it('formats a single field error with node + field prefix', () => {
    expect(
      summarizeApiErrorBody(
        {
          kind: 'fieldErrors',
          items: [{ nodeId: 'n1', field: 'template_name', message: 'is required' }],
        },
        'fallback',
      ),
    ).toBe('n1 · template_name: is required');
  });

  it('falls through to a count for multiple field errors', () => {
    expect(
      summarizeApiErrorBody(
        {
          kind: 'fieldErrors',
          items: [
            { nodeId: 'n1', field: 'a', message: 'm1' },
            { nodeId: 'n2', field: 'b', message: 'm2' },
          ],
        },
        'fallback',
      ),
    ).toBe('2 validation issues');
  });

  it('returns fallback for unknown', () => {
    expect(
      summarizeApiErrorBody({ kind: 'unknown', raw: {} }, 'fallback'),
    ).toBe('fallback');
  });
});

describe('fieldErrorsFromZodIssues', () => {
  it('maps a flat issues array into FieldErrorItems', () => {
    const items = fieldErrorsFromZodIssues(
      [
        { path: ['config', 'template_name'], message: 'Required' },
        { path: [], message: 'Top-level' },
      ],
      'node-7',
    );
    expect(items).toEqual([
      { nodeId: 'node-7', field: 'config.template_name', message: 'Required' },
      { nodeId: 'node-7', field: null, message: 'Top-level' },
    ]);
  });
});
