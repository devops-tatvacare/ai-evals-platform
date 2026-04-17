// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useChatWidgetStore } from './useChatWidget';
import { getBuilderSession, streamChatMessage } from './api';

vi.mock('./api', () => ({
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
});
