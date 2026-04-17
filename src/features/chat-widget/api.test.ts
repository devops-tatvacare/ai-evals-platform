// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';

import { streamChatMessage } from './api';

const body = {
  appId: 'kaira-bot',
  sessionId: 'session-1',
  turnId: 'turn-1',
  operation: 'send' as const,
  message: 'show me trends',
  model: 'gpt-5.4-mini',
};

function createSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('streamChatMessage parses v2 events including blueprint and save_result payloads', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    createSseResponse([
      'event: session\ndata: {"sessionId":"session-1","provider":"openai","model":"gpt-5.4-mini","lastEventSeq":2}\n\n',
      'event: entity_recognition\ndata: {"seq":3,"entities":[{"text":"adversarial","type":"eval_type","confidence":0.9}],"isPlatformQuery":true}\n\n',
      'event: tool_call_start\ndata: {"seq":4,"toolCallId":"tc_1","toolName":"data_query"}\n\n',
      'event: tool_call_end\ndata: {"seq":5,"toolCallId":"tc_1","toolName":"data_query","summary":"7 rows","detail":{"executionMs":12,"rowCount":7,"cacheHit":false,"error":null},"durationMs":12}\n\n',
      'event: done\ndata: {"seq":6,"terminalStatus":"degraded","content":"Done","toolCalls":[{"toolCallId":"tc_1","name":"data_query","summary":"7 rows","detail":{"executionMs":12,"rowCount":7,"cacheHit":false,"error":null}}],"chart":null,"blueprint":{"name":"Weekly review","sections":[{"id":"overview","title":"Overview","type":"summary_cards"}]},"warnings":["partial data"]}\n\n',
    ]),
  );

  const onSessionId = vi.fn();
  const onEntityRecognition = vi.fn();
  const onToolCallStart = vi.fn();
  const onToolCallEnd = vi.fn();
  const onContentDelta = vi.fn();
  const onChart = vi.fn();
  const onBlueprint = vi.fn();
  const onSaveResult = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();

  await streamChatMessage(body, {
    onSessionId,
    onEntityRecognition,
    onToolCallStart,
    onToolCallEnd,
    onContentDelta,
    onChart,
    onBlueprint,
    onSaveResult,
    onDone,
    onError,
  });
  await flushPromises();

  expect(onSessionId).toHaveBeenCalledWith(expect.objectContaining({ lastEventSeq: 2 }));
  expect(onEntityRecognition).toHaveBeenCalledWith(expect.objectContaining({ seq: 3 }));
  expect(onToolCallStart).toHaveBeenCalledWith(expect.objectContaining({ seq: 4, toolCallId: 'tc_1' }));
  expect(onToolCallEnd).toHaveBeenCalledWith(expect.objectContaining({ seq: 5, durationMs: 12 }));
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ seq: 6, terminalStatus: 'degraded' }));
  expect(onError).not.toHaveBeenCalled();
  expect(onContentDelta).not.toHaveBeenCalled();
  expect(onChart).not.toHaveBeenCalled();
  expect(onBlueprint).not.toHaveBeenCalled();
  expect(onSaveResult).not.toHaveBeenCalled();
});

test('streamChatMessage parses structured non-OK errors', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: 'session_not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const onError = vi.fn();

  await streamChatMessage(body, {
    onSessionId: vi.fn(),
    onEntityRecognition: vi.fn(),
    onToolCallStart: vi.fn(),
    onToolCallEnd: vi.fn(),
    onContentDelta: vi.fn(),
    onChart: vi.fn(),
    onBlueprint: vi.fn(),
    onSaveResult: vi.fn(),
    onDone: vi.fn(),
    onError,
  });
  await flushPromises();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({
    message: 'session_not_found',
    terminalStatus: 'error',
  }));
});

test('streamChatMessage forwards resume requests without a message body', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    createSseResponse([
      'event: session\ndata: {"sessionId":"session-1","provider":"openai","model":"gpt-5.4-mini"}\n\n',
      'event: done\ndata: {"seq":5,"terminalStatus":"done","content":"Resumed","toolCalls":[],"chart":null,"blueprint":null,"warnings":[]}\n\n',
    ]),
  );

  await streamChatMessage(
      {
        appId: 'kaira-bot',
        sessionId: 'session-1',
        turnId: 'turn-1',
        operation: 'resume',
        model: 'gpt-5.4-mini',
      },
    {
      onSessionId: vi.fn(),
      onEntityRecognition: vi.fn(),
      onToolCallStart: vi.fn(),
      onToolCallEnd: vi.fn(),
      onContentDelta: vi.fn(),
      onChart: vi.fn(),
      onBlueprint: vi.fn(),
      onSaveResult: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    },
  );
  await flushPromises();

  expect(fetchSpy).toHaveBeenCalledWith(
    '/api/report-builder/v2/chat/stream',
    expect.objectContaining({
      body: JSON.stringify({
        appId: 'kaira-bot',
        sessionId: 'session-1',
        turnId: 'turn-1',
        operation: 'resume',
        model: 'gpt-5.4-mini',
      }),
    }),
  );
});

test('streamChatMessage emits EOF fallback when no terminal event arrives', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    createSseResponse([
      'event: session\ndata: {"sessionId":"session-1","provider":"openai","model":"gpt-5.4-mini","lastEventSeq":0}\n\n',
      'event: content_delta\ndata: {"seq":1,"delta":"Hello"}\n\n',
    ]),
  );

  const onContentDelta = vi.fn();
  const onError = vi.fn();

  await streamChatMessage(body, {
    onSessionId: vi.fn(),
    onEntityRecognition: vi.fn(),
    onToolCallStart: vi.fn(),
    onToolCallEnd: vi.fn(),
    onContentDelta,
    onChart: vi.fn(),
    onBlueprint: vi.fn(),
    onSaveResult: vi.fn(),
    onDone: vi.fn(),
    onError,
  });
  await flushPromises();

  expect(onContentDelta).toHaveBeenCalledWith({ seq: 1, delta: 'Hello' });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({
    terminalStatus: 'error',
    content: 'Hello',
  }));
  expect(onError.mock.calls[0][0].message).toMatch(/terminal runtime event/i);
});

test('streamChatMessage surfaces an error after too many malformed payloads', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    createSseResponse([
      'event: session\ndata: {"sessionId":"session-1","provider":"openai","model":"gpt-5.4-mini","lastEventSeq":0}\n\n',
      'event: content_delta\ndata: {bad-json}\n\n',
      'event: content_delta\ndata: {bad-json}\n\n',
      'event: content_delta\ndata: {bad-json}\n\n',
      'event: content_delta\ndata: {bad-json}\n\n',
    ]),
  );

  const onError = vi.fn();

  await streamChatMessage(body, {
    onSessionId: vi.fn(),
    onEntityRecognition: vi.fn(),
    onToolCallStart: vi.fn(),
    onToolCallEnd: vi.fn(),
    onContentDelta: vi.fn(),
    onChart: vi.fn(),
    onBlueprint: vi.fn(),
    onSaveResult: vi.fn(),
    onDone: vi.fn(),
    onError,
  });
  await flushPromises();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringMatching(/malformed sse payload/i),
  }));
});
