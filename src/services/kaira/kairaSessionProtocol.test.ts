import { expect, test } from 'vitest';

import {
  applySessionUpdate,
  createSessionState,
  processChunk,
} from './kairaSessionProtocol';

test('processChunk strips food card sentinels split across token chunks', () => {
  const state = createSessionState('kaira-user-1');
  let visible = '';

  const chunks = [
    'Meal summary ',
    '___FO',
    'OD_CARD',
    '___{"items":[',
    '{"name":"roti"}',
    ']}___',
    'END___',
    ' is ready.',
  ];

  for (const content of chunks) {
    const result = processChunk({ type: 'token', content }, state);
    visible += result.content.message ?? '';
  }

  expect(visible).toBe('Meal summary  is ready.');
  expect(state._inSentinel).toBe(false);
  expect(state._sentinelBuffer).toBe('');
});

test('classification chunk persists session id and flips newSession off', () => {
  const state = createSessionState('kaira-user-1');
  const result = processChunk(
    {
      type: 'classification',
      intent: 'greeting',
      agent: 'GeneralAgent',
      confidence: 0.93,
      source: 'text',
      session_id: 'sess_abc',
    },
    state,
  );

  const updated = result.sessionUpdate
    ? applySessionUpdate(state, result.sessionUpdate)
    : state;

  expect(updated.sessionId).toBe('sess_abc');
  expect(updated.newSession).toBe(false);
});
