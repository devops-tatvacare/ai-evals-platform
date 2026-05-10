// @vitest-environment jsdom

/**
 * Phase 3 Step 7 — `useChatWidgetStore.send()` injects the view-mode
 * suggestion ABOVE the user message when the user is viewing the
 * builder and types an authoring-shaped prompt.
 *
 * Scope: the injection is per-MESSAGE — it re-fires the next time the
 * user types this shape while still in view mode.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useChatWidgetStore } from './useChatWidget';
import { VIEW_MODE_SUGGESTION_TEXT } from './components/BuilderContextChip';

vi.mock('./api', () => ({
  cancelChatTurn: vi.fn(),
  getBuilderSession: vi.fn(),
  getChatDefaults: vi.fn(),
  streamChatMessage: vi.fn(() => Promise.resolve({ abort() {} })),
}));

vi.mock('@/services/api/chatApi', () => ({
  chatSessionsRepository: { getAll: vi.fn(), delete: vi.fn() },
  chatMessagesRepository: { getBySession: vi.fn() },
  CHAT_SESSION_SOURCE: { sherlock: 'sherlock' },
}));

const getPageContextSnapshot = vi.fn();

vi.mock('@/features/orchestration/copilot/usePageContext', () => ({
  getPageContextSnapshot: () => getPageContextSnapshot(),
}));

vi.mock('@/features/orchestration/copilot/canvasPatchApplier', () => ({
  applyCanvasPatch: vi.fn(),
  consumeRebaseRedo: vi.fn(() => null),
}));


function viewBuilderContext() {
  return {
    kind: 'orchestration_builder' as const,
    workflowId: 'wf_demo',
    versionId: null,
    workflowType: 'crm' as const,
    appId: 'inside-sales',
    selectedNodeId: null,
    definition: { nodes: [], edges: [] },
    dataHash: 'h1',
    viewMode: 'view' as const,
    workflowName: 'demo',
  };
}

function editBuilderContext() {
  return { ...viewBuilderContext(), viewMode: 'edit' as const };
}

function offBuilderContext() {
  return { kind: 'none' as const };
}


describe('useChatWidgetStore.send — view-mode authoring suggestion', () => {
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
      defaults: {
        openai: { model: 'gpt-5.4' },
      } as never,
    });
    getPageContextSnapshot.mockReset();
    vi.clearAllMocks();
  });

  test('injects suggestion above user message when viewing + authoring shape', async () => {
    getPageContextSnapshot.mockReturnValue(viewBuilderContext());

    void useChatWidgetStore.getState().send('add a Bolna fallback', 'inside-sales');

    const messages = useChatWidgetStore.getState().messages;
    // Two messages: assistant suggestion, then the user message.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].parts[0]).toEqual({
      type: 'text',
      content: VIEW_MODE_SUGGESTION_TEXT,
    });
    expect(messages[1].role).toBe('user');
    expect(messages[1].parts[0]).toEqual({
      type: 'text',
      content: 'add a Bolna fallback',
    });
  });

  test('does NOT inject in edit mode even with authoring shape', async () => {
    getPageContextSnapshot.mockReturnValue(editBuilderContext());

    void useChatWidgetStore.getState().send('add a Bolna fallback', 'inside-sales');

    const messages = useChatWidgetStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  test('does NOT inject for read-only-shaped prompts even when viewing', async () => {
    getPageContextSnapshot.mockReturnValue(viewBuilderContext());

    void useChatWidgetStore.getState().send('what does this branch do?', 'inside-sales');

    const messages = useChatWidgetStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  test('does NOT inject when off the builder', async () => {
    getPageContextSnapshot.mockReturnValue(offBuilderContext());

    void useChatWidgetStore.getState().send('add a Bolna fallback', 'inside-sales');

    const messages = useChatWidgetStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  test('re-fires on each matching submit (per-message, not per-session)', async () => {
    // Both submits go through with the same view-mode context.
    getPageContextSnapshot.mockReturnValue(viewBuilderContext());
    void useChatWidgetStore.getState().send('add a node', 'inside-sales');
    void useChatWidgetStore.getState().send('also remove the SMS step', 'inside-sales');

    const messages = useChatWidgetStore.getState().messages;
    // Two suggestions + two user messages = 4 messages total.
    const suggestions = messages.filter((m) =>
      m.role === 'assistant' &&
      m.parts.some((p) => p.type === 'text' && p.content === VIEW_MODE_SUGGESTION_TEXT),
    );
    expect(suggestions).toHaveLength(2);
  });
});
