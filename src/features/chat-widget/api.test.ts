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

test('streamChatMessage parses v3 events including artifacts and usage', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    createSseResponse([
      'event: session\ndata: {"sessionId":"session-1","provider":"azure_openai","model":"ai-evals-gpt-5.4","lastEventSeq":2}\n\n',
      'event: specialist_started\ndata: {"seq":3,"call_id":"call_1","specialist":"data_specialist","brief_summary":"Count runs"}\n\n',
      'event: specialist_finished\ndata: {"seq":4,"call_id":"call_1","specialist":"data_specialist","status":"ok","result_summary":"chart: 7 rows","duration_ms":12}\n\n',
      'event: content_delta\ndata: {"seq":5,"phase":"commentary","text":"{\\"input\\":\\"Task: Count runs\\"}"}\n\n',
      'event: content_delta\ndata: {"seq":6,"phase":"final_answer","text":"Done"}\n\n',
      'event: artifact_emitted\ndata: {"seq":7,"kind":"chart","payload":{"kind":"empty","reason_code":"CG_EMPTY","title":"Runs"}}\n\n',
      'event: turn_finished\ndata: {"seq":8,"status":"done","content":"Done","toolCalls":[{"toolCallId":"call_1","name":"data_specialist","summary":"chart: 7 rows","detail":{"executionMs":12,"error":null}}],"artifacts":[{"pack_id":"analytics","contract_id":"analytics.chart.v1","payload":{"kind":"empty","reason_code":"CG_EMPTY","title":"Runs"},"extras":{}}],"usage":{"input_tokens":1335,"output_tokens":385,"cached_read_tokens":10,"call_count":2,"cost_usd":0.0123}}\n\n',
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
  const onStatus = vi.fn();
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
    onStatus,
    onDone,
    onError,
  });
  await flushPromises();

  expect(onSessionId).toHaveBeenCalledWith(expect.objectContaining({ lastEventSeq: 2 }));
  expect(onEntityRecognition).not.toHaveBeenCalled();
  expect(onToolCallStart).toHaveBeenCalledWith(expect.objectContaining({ seq: 3, toolCallId: 'call_1', toolName: 'data_specialist' }));
  expect(onToolCallEnd).toHaveBeenCalledWith(expect.objectContaining({ seq: 4, durationMs: 12 }));
  expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ seq: 5 }));
  expect(onContentDelta).toHaveBeenCalledWith({ seq: 6, delta: 'Done' });
  expect(onChart).toHaveBeenCalledWith(expect.objectContaining({
    seq: 7,
    payload: expect.objectContaining({ kind: 'empty' }),
  }));
  expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
    seq: 8,
    terminalStatus: 'done',
    content: 'Done',
    artifacts: [
      expect.objectContaining({
        pack_id: 'analytics',
        contract_id: 'analytics.chart.v1',
      }),
    ],
    usage: expect.objectContaining({
      inputTokens: 1335,
      outputTokens: 385,
      cachedReadTokens: 10,
      totalTokens: 1730,
      callCount: 2,
      costUsd: 0.0123,
    }),
  }));
  expect(onError).not.toHaveBeenCalled();
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
    onStatus: vi.fn(),
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
      'event: session\ndata: {"sessionId":"session-1","provider":"azure_openai","model":"ai-evals-gpt-5.4"}\n\n',
      'event: turn_finished\ndata: {"seq":5,"status":"done","content":"Resumed","toolCalls":[],"artifacts":[],"warnings":[]}\n\n',
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
      onStatus: vi.fn(),
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
      'event: content_delta\ndata: {"seq":1,"phase":"final_answer","text":"Hello"}\n\n',
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
    onStatus: vi.fn(),
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
    onStatus: vi.fn(),
    onDone: vi.fn(),
    onError,
  });
  await flushPromises();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.stringMatching(/malformed sse payload/i),
  }));
});
