// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useChatWidgetStore } from './useChatWidget';
import { cancelChatTurn, getBuilderSession, streamChatMessage } from './api';

vi.mock('./api', () => ({
  cancelChatTurn: vi.fn(),
  getBuilderSession: vi.fn(),
  getChatDefaults: vi.fn(),
  streamChatMessage: vi.fn(),
}));

vi.mock('@/services/api/chatApi', () => ({
  chatSessionsRepository: {
    getAll: vi.fn(),
    delete: vi.fn(),
  },
  chatMessagesRepository: {
    getBySession: vi.fn(),
  },
}));

describe('useChatWidgetStore restoreSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useChatWidgetStore.getState().newChat();
    useChatWidgetStore.setState({
      open: false,
      provider: 'openai',
      messages: [],
      status: 'idle',
      lastAppliedSeq: 0,
      streamingParts: [],
    });
    vi.clearAllMocks();
  });

  test('resume loads completed turn data instead of replaying events', async () => {
    sessionStorage.setItem('sherlock-active-session', JSON.stringify({
      sessionId: 'session-1',
      dbSessionId: 'session-1',
      provider: 'openai',
      appId: 'kaira-bot',
      open: true,
    }));

    vi.mocked(getBuilderSession).mockResolvedValue({
      sessionId: 'session-1',
      provider: 'openai',
      model: 'gpt-5.4',
      activeTurnId: null,
      lastEventSeq: 0,
      currentTurnStatus: 'done',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'show me weekly pass rate',
          status: 'complete',
          createdAt: '2026-04-14T00:00:00.000Z',
          metadata: null,
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Pass rate is 91%',
          status: 'complete',
          createdAt: '2026-04-14T00:00:01.000Z',
          metadata: { terminalStatus: 'done', toolCalls: [] },
        },
      ],
    } as never);

    await useChatWidgetStore.getState().restoreSession('kaira-bot');

    const state = useChatWidgetStore.getState();

    expect(state.open).toBe(true);
    expect(state.sessionId).toBe('session-1');
    expect(state.provider).toBe('openai');
    expect(state.activeTurnId).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].parts).toEqual([{ type: 'text', content: 'Pass rate is 91%' }]);
    expect(vi.mocked(streamChatMessage)).not.toHaveBeenCalled();
  });

  test('resumeActiveTurn does not re-send the original message body', async () => {
    vi.mocked(streamChatMessage).mockResolvedValue({ abort() {} } as never);

    useChatWidgetStore.setState({
      sessionId: 'session-1',
      activeTurnId: 'turn-1',
      lastAppliedSeq: 4,
      provider: 'openai',
      defaults: {
        openai: { model: 'gpt-5.4-mini' },
      },
    } as never);

    await useChatWidgetStore.getState().resumeActiveTurn('kaira-bot');

    const [request] = vi.mocked(streamChatMessage).mock.calls[0];
    expect(request).toMatchObject({
      operation: 'resume',
      turnId: 'turn-1',
    });
    expect('message' in request).toBe(false);
    expect('provider' in request).toBe(false);
    expect('resumeFromSeq' in request).toBe(false);
  });

  test('send resets event sequencing so specialist blocks render on later turns', async () => {
    let turnIndex = 0;
    vi.mocked(streamChatMessage).mockImplementation(async (_request, callbacks) => {
      turnIndex += 1;
      callbacks.onSessionId({
        sessionId: 'session-1',
        provider: 'openai',
        model: 'gpt-5.4-mini',
        lastEventSeq: 99,
      });
      callbacks.onToolCallStart({
        seq: 1,
        toolCallId: `call_${turnIndex}`,
        toolName: 'data_specialist',
        briefSummary: `turn ${turnIndex}`,
      });
      callbacks.onToolCallEnd({
        seq: 2,
        toolCallId: `call_${turnIndex}`,
        toolName: 'data_specialist',
        summary: `${turnIndex} rows`,
        detail: { executionMs: 10, rowCount: turnIndex, error: null },
        durationMs: 10,
      });
      callbacks.onDone({
        seq: 3,
        terminalStatus: 'done',
        content: `done ${turnIndex}`,
        toolCalls: [],
        artifacts: [],
      });
      return { abort() {} } as never;
    });

    useChatWidgetStore.setState({
      sessionId: 'session-1',
      provider: 'openai',
      defaults: {
        openai: { model: 'gpt-5.4-mini' },
      },
      lastAppliedSeq: 3,
    } as never);

    await useChatWidgetStore.getState().send('first', 'kaira-bot');
    await useChatWidgetStore.getState().send('second', 'kaira-bot');

    const assistantMessages = useChatWidgetStore
      .getState()
      .messages
      .filter((message) => message.role === 'assistant');

    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0].parts[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call_1',
      summary: '1 rows',
    });
    expect(assistantMessages[1].parts[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'call_2',
      summary: '2 rows',
    });
  });

  test('stopActiveTurn calls the cancel endpoint for the active turn', async () => {
    vi.mocked(cancelChatTurn).mockResolvedValue({
      sessionId: 'session-1',
      turnId: 'turn-1',
      result: 'cancelled',
      turnStatus: 'interrupted',
      message: 'Cancelled by user',
    });

    useChatWidgetStore.setState({
      sessionId: 'session-1',
      activeTurnId: 'turn-1',
      status: 'sending',
    } as never);

    await useChatWidgetStore.getState().stopActiveTurn('kaira-bot');

    expect(vi.mocked(cancelChatTurn)).toHaveBeenCalledWith('kaira-bot', 'session-1', 'turn-1');
    expect(vi.mocked(getBuilderSession)).not.toHaveBeenCalled();
    expect(useChatWidgetStore.getState().streamingStatus).toBe('Stopping…');
  });

  test('stopActiveTurn refreshes the session when the turn is already terminal', async () => {
    vi.mocked(cancelChatTurn).mockResolvedValue({
      sessionId: 'session-1',
      turnId: 'turn-1',
      result: 'already_terminal',
      turnStatus: 'interrupted',
      message: 'Turn already finished',
    });
    vi.mocked(getBuilderSession).mockResolvedValue({
      sessionId: 'session-1',
      provider: 'openai',
      model: 'gpt-5.4',
      activeTurnId: null,
      lastEventSeq: 0,
      currentTurnStatus: 'interrupted',
      messages: [
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Cancelled by user',
          status: 'error',
          createdAt: '2026-04-14T00:00:01.000Z',
          metadata: { terminalStatus: 'interrupted', lastError: 'Cancelled by user' },
        },
      ],
    } as never);

    useChatWidgetStore.setState({
      sessionId: 'session-1',
      activeTurnId: 'turn-1',
      status: 'sending',
      open: true,
    } as never);

    await useChatWidgetStore.getState().stopActiveTurn('kaira-bot');

    expect(vi.mocked(getBuilderSession)).toHaveBeenCalledWith('kaira-bot', 'session-1');
    const state = useChatWidgetStore.getState();
    expect(state.activeTurnId).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.messages[0]?.parts).toEqual([{ type: 'text', content: 'Cancelled by user' }]);
  });
});
