import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStreamStore } from '@/features/sherlock/streamStore';

const mocks = vi.hoisted(() => ({
  streamTurn: vi.fn(),
  cancelChatTurn: vi.fn(),
  getBuilderSession: vi.fn(),
  notificationService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/features/sherlock/sse', () => ({
  streamTurn: (...args: unknown[]) => mocks.streamTurn(...args),
}));

vi.mock('@/features/orchestration/queries/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock('@/services/api/chatApi', () => ({
  CHAT_SESSION_SOURCE: { sherlock: 'sherlock' },
  chatSessionsRepository: {
    getAll: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/notifications', () => ({
  notificationService: mocks.notificationService,
}));

vi.mock('./api', () => ({
  cancelChatTurn: (...args: unknown[]) => mocks.cancelChatTurn(...args),
  getBuilderSession: (...args: unknown[]) => mocks.getBuilderSession(...args),
}));

import { useChatWidgetStore } from './useChatWidget';

interface FakeControls {
  abort: ReturnType<typeof vi.fn>;
  done: Promise<{ status: string; lastError: string | null }>;
  resolveDone: (t: { status: string; lastError: string | null }) => void;
  lastOptions: Record<string, unknown> | null;
}

function makeFakeStream(): FakeControls {
  const abort = vi.fn();
  let resolveInner: (t: { status: string; lastError: string | null }) => void = () => {};
  const done = new Promise<{ status: string; lastError: string | null }>((r) => {
    resolveInner = r;
  });
  const controls: FakeControls = {
    abort,
    done,
    lastOptions: null,
    resolveDone(payload) {
      const onTerminal = controls.lastOptions?.onTerminal as
        | ((t: { status: string; lastError: string | null }) => void)
        | undefined;
      onTerminal?.(payload);
      resolveInner(payload);
    },
  };
  return controls;
}

beforeEach(() => {
  useStreamStore.setState({
    partsBySession: {},
    lastSeqBySession: {},
    hasGapBySession: {},
    status: 'idle',
  });
  useChatWidgetStore.setState({
    open: false,
    view: 'chat',
    pendingPrompt: null,
    sessionId: null,
    activeTurnId: null,
    status: 'idle',
    errorMessage: null,
    sessions: [],
    sessionsLoaded: false,
    lastUserPrompt: null,
  });
  mocks.streamTurn.mockReset();
  mocks.cancelChatTurn.mockReset();
  mocks.getBuilderSession.mockReset();
  mocks.notificationService.error.mockReset();
});

afterEach(() => {
  useChatWidgetStore.getState().abortActiveStream();
});

describe('useChatWidgetStore', () => {
  it('send() marks sending, records lastUserPrompt, and calls streamTurn', async () => {
    const controls = makeFakeStream();
    mocks.streamTurn.mockImplementation((opts: Record<string, unknown>) => {
      controls.lastOptions = opts;
      return { abort: controls.abort, done: controls.done };
    });

    const pending = useChatWidgetStore.getState().send('hello', 'inside-sales');

    expect(useChatWidgetStore.getState().status).toBe('sending');
    expect(useChatWidgetStore.getState().lastUserPrompt).toBe('hello');
    expect(useChatWidgetStore.getState().activeTurnId).toBeTruthy();
    expect(mocks.streamTurn).toHaveBeenCalledOnce();
    expect(controls.lastOptions?.appId).toBe('inside-sales');
    expect(controls.lastOptions?.message).toBe('hello');
    expect(controls.lastOptions?.operation).toBe('send');

    controls.resolveDone({ status: 'done', lastError: null });
    await pending;
    expect(useChatWidgetStore.getState().status).toBe('idle');
    expect(useChatWidgetStore.getState().activeTurnId).toBeNull();
  });

  it('send() onSession commits the resolved sessionId', async () => {
    const controls = makeFakeStream();
    mocks.streamTurn.mockImplementation((opts: Record<string, unknown>) => {
      controls.lastOptions = opts;
      return { abort: controls.abort, done: controls.done };
    });

    const pending = useChatWidgetStore.getState().send('hi', 'inside-sales');
    const onSession = controls.lastOptions?.onSession as (s: { sessionId: string }) => void;
    onSession({ sessionId: 'sess-minted' });
    expect(useChatWidgetStore.getState().sessionId).toBe('sess-minted');
    controls.resolveDone({ status: 'done', lastError: null });
    await pending;
  });

  it('send() during an in-flight turn aborts the prior stream', async () => {
    const first = makeFakeStream();
    const second = makeFakeStream();
    mocks.streamTurn
      .mockImplementationOnce((opts: Record<string, unknown>) => {
        first.lastOptions = opts;
        return { abort: first.abort, done: first.done };
      })
      .mockImplementationOnce((opts: Record<string, unknown>) => {
        second.lastOptions = opts;
        return { abort: second.abort, done: second.done };
      });

    void useChatWidgetStore.getState().send('one', 'inside-sales');
    const pending = useChatWidgetStore.getState().send('two', 'inside-sales');
    expect(first.abort).toHaveBeenCalledOnce();
    expect(useChatWidgetStore.getState().lastUserPrompt).toBe('two');
    second.resolveDone({ status: 'done', lastError: null });
    first.resolveDone({ status: 'interrupted', lastError: null });
    await pending;
  });

  it('stopActiveTurn aborts stream + calls cancelChatTurn + resets status', async () => {
    const controls = makeFakeStream();
    mocks.streamTurn.mockImplementation((opts: Record<string, unknown>) => {
      controls.lastOptions = opts;
      return { abort: controls.abort, done: controls.done };
    });
    mocks.cancelChatTurn.mockResolvedValue({ result: 'cancelled' });
    useChatWidgetStore.setState({ sessionId: 'sess-1' });

    const pending = useChatWidgetStore.getState().send('hi', 'inside-sales');
    await useChatWidgetStore.getState().stopActiveTurn('inside-sales');

    expect(controls.abort).toHaveBeenCalled();
    expect(mocks.cancelChatTurn).toHaveBeenCalledWith('inside-sales', 'sess-1', expect.any(String));
    expect(useChatWidgetStore.getState().status).toBe('idle');
    expect(useChatWidgetStore.getState().activeTurnId).toBeNull();
    controls.resolveDone({ status: 'interrupted', lastError: null });
    await pending;
  });

  it('retryLastMessage resends the last prompt', async () => {
    const first = makeFakeStream();
    const second = makeFakeStream();
    mocks.streamTurn
      .mockImplementationOnce((opts: Record<string, unknown>) => {
        first.lastOptions = opts;
        return { abort: first.abort, done: first.done };
      })
      .mockImplementationOnce((opts: Record<string, unknown>) => {
        second.lastOptions = opts;
        return { abort: second.abort, done: second.done };
      });

    const initial = useChatWidgetStore.getState().send('original', 'inside-sales');
    first.resolveDone({ status: 'error', lastError: 'kaboom' });
    await initial;
    expect(useChatWidgetStore.getState().status).toBe('error');

    const retry = useChatWidgetStore.getState().retryLastMessage('inside-sales');
    expect(mocks.streamTurn).toHaveBeenCalledTimes(2);
    second.resolveDone({ status: 'done', lastError: null });
    await retry;
    expect(useChatWidgetStore.getState().status).toBe('idle');
  });

  it('newChat aborts the active stream + resets the prior session bucket', () => {
    const controls = makeFakeStream();
    mocks.streamTurn.mockImplementation((opts: Record<string, unknown>) => {
      controls.lastOptions = opts;
      return { abort: controls.abort, done: controls.done };
    });
    useChatWidgetStore.setState({ sessionId: 'sess-1' });
    useStreamStore.getState().seed('sess-1', [], 1);

    void useChatWidgetStore.getState().send('hi', 'inside-sales');
    useChatWidgetStore.getState().newChat();

    expect(controls.abort).toHaveBeenCalledOnce();
    expect(useStreamStore.getState().partsBySession['sess-1']).toBeUndefined();
    expect(useChatWidgetStore.getState().sessionId).toBeNull();
    controls.resolveDone({ status: 'interrupted', lastError: null });
  });

  it('selectSession resets the prior session bucket + persists pointer', async () => {
    mocks.getBuilderSession.mockResolvedValue({
      sessionId: 'sess-new',
      currentTurnStatus: 'completed',
      activeTurnId: null,
    });
    useChatWidgetStore.setState({ sessionId: 'sess-old' });
    useStreamStore.getState().seed('sess-old', [], 1);

    await useChatWidgetStore.getState().selectSession('inside-sales', 'sess-new');
    expect(useStreamStore.getState().partsBySession['sess-old']).toBeUndefined();
    expect(useChatWidgetStore.getState().sessionId).toBe('sess-new');
    expect(useChatWidgetStore.getState().status).toBe('idle');
  });

  it('resetForSignOut wipes every session bucket', () => {
    useStreamStore.getState().seed('sess-a', [], 1);
    useStreamStore.getState().seed('sess-b', [], 1);
    useChatWidgetStore.setState({ sessionId: 'sess-a' });

    useChatWidgetStore.getState().resetForSignOut();

    expect(useStreamStore.getState().partsBySession).toEqual({});
    expect(useChatWidgetStore.getState().sessionId).toBeNull();
    expect(useChatWidgetStore.getState().open).toBe(false);
  });
});
