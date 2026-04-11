import { create } from 'zustand';
import { sendChatMessage, getChatDefaults } from './api';
import { chatSessionsRepository, chatMessagesRepository } from '@/services/api/chatApi';
import type { AppId } from '@/types';
import type { ChatDefaults, ChatProvider, WidgetMessage, WidgetView, WidgetSessionSummary } from './types';

let msgCounter = 0;
const nextId = () => `msg_${++msgCounter}`;

interface ChatWidgetStore {
  // UI
  open: boolean;
  view: WidgetView;
  pendingPrompt: string | null;
  toggle: () => void;
  setView: (v: WidgetView) => void;
  openWithPrompt: (prompt: string, appId: string) => void;
  consumePendingPrompt: () => string | null;

  // Current session
  sessionId: string | null;
  dbSessionId: string | null; // ChatSession.id in the DB (separate from report-builder session)
  provider: ChatProvider | null;
  locked: boolean;
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  activeToolCall: string | null;

  // Session history
  sessions: WidgetSessionSummary[];
  sessionsLoaded: boolean;
  loadSessions: (appId: AppId) => Promise<void>;
  selectSession: (appId: AppId, sessionId: string) => Promise<void>;
  deleteSession: (appId: AppId, sessionId: string) => Promise<void>;

  // Actions
  setProvider: (p: ChatProvider) => void;
  send: (text: string, appId: string) => Promise<void>;
  newChat: () => void;

  // Defaults
  defaults: ChatDefaults | null;
  loadDefaults: () => Promise<void>;
}

export const useChatWidgetStore = create<ChatWidgetStore>((set, get) => ({
  // ── UI ──
  open: false,
  view: 'chat',
  pendingPrompt: null,

  toggle: () => set((s) => ({ open: !s.open })),

  setView: (v) => set({ view: v }),

  openWithPrompt: (prompt, appId) => {
    const { provider, defaults } = get();
    set({ open: true, view: 'chat', pendingPrompt: prompt });
    if (provider && defaults) {
      setTimeout(() => {
        const current = get();
        if (current.pendingPrompt) {
          set({ pendingPrompt: null });
          void current.send(prompt, appId);
        }
      }, 0);
    }
  },

  consumePendingPrompt: () => {
    const prompt = get().pendingPrompt;
    if (prompt) set({ pendingPrompt: null });
    return prompt;
  },

  // ── Current session ──
  sessionId: null,
  dbSessionId: null,
  provider: null,
  locked: false,
  messages: [],
  status: 'idle',
  activeToolCall: null,

  // ── Session history ──
  sessions: [],
  sessionsLoaded: false,

  loadSessions: async (appId) => {
    try {
      const sessions = await chatSessionsRepository.getAll(appId);
      // Filter to sherlock sessions (title prefix or all — we use the same chat sessions table)
      set({
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          status: s.status,
        })),
        sessionsLoaded: true,
      });
    } catch {
      set({ sessionsLoaded: true });
    }
  },

  selectSession: async (appId, sessionId) => {
    try {
      const dbMessages = await chatMessagesRepository.getBySession(appId, sessionId);
      const widgetMessages: WidgetMessage[] = dbMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: ((m.metadata as any)?.toolCalls ?? []).map((tc: any) => ({
          name: tc.name,
          summary: tc.summary,
          status: 'done' as const,
        })),
        composedReport: (m.metadata as any)?.composedReport ?? null,
        status: 'complete' as const,
      }));

      set({
        dbSessionId: sessionId,
        sessionId: null, // report-builder session will be re-created on next send
        messages: widgetMessages,
        locked: false,
        view: 'chat',
      });
    } catch {
      // If loading fails, just switch to chat view
      set({ view: 'chat' });
    }
  },

  deleteSession: async (appId, sessionId) => {
    try {
      await chatSessionsRepository.delete(appId, sessionId);
      set((s) => ({
        sessions: s.sessions.filter((ss) => ss.id !== sessionId),
        // If the deleted session was active, reset
        ...(s.dbSessionId === sessionId
          ? { dbSessionId: null, sessionId: null, messages: [], locked: false }
          : {}),
      }));
    } catch {
      // Silently fail
    }
  },

  // ── Actions ──
  setProvider: (p) => {
    if (get().locked) return;
    set({ provider: p });
  },

  send: async (text, appId) => {
    const { provider, defaults, sessionId, dbSessionId } = get();
    if (!provider || !defaults) return;

    const model = defaults[provider].model;

    const userMsg: WidgetMessage = {
      id: nextId(),
      role: 'user',
      content: text,
      toolCalls: [],
      status: 'complete',
    };

    const assistantId = nextId();
    const assistantMsg: WidgetMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      status: 'streaming',
    };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      status: 'sending',
      locked: true,
      view: 'chat',
    }));

    try {
      const response = await sendChatMessage({
        appId,
        sessionId,
        message: text,
        provider,
        model,
      });

      const toolCalls = response.toolCalls.map((tc) => ({
        name: tc.name,
        summary: tc.summary,
        status: 'done' as const,
      }));

      set((s) => ({
        sessionId: response.sessionId,
        status: 'idle',
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: response.content,
                toolCalls,
                composedReport: response.composedReport,
                status: 'complete' as const,
              }
            : m,
        ),
      }));

      // Persist to DB (fire-and-forget)
      void _persistMessages(appId as AppId, dbSessionId, text, response.content, {
        toolCalls: response.toolCalls,
        composedReport: response.composedReport,
      }).then((newDbSessionId) => {
        if (newDbSessionId) {
          set({ dbSessionId: newDbSessionId });
        }
      });
    } catch (err) {
      set((s) => ({
        status: 'error',
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: err instanceof Error ? err.message : 'Request failed',
                status: 'error' as const,
              }
            : m,
        ),
      }));
    }
  },

  newChat: () =>
    set({
      sessionId: null,
      dbSessionId: null,
      locked: false,
      messages: [],
      status: 'idle',
      activeToolCall: null,
      pendingPrompt: null,
      view: 'chat',
    }),

  // ── Defaults ──
  defaults: null,
  loadDefaults: async () => {
    try {
      const defaults = await getChatDefaults();
      set({ defaults });
    } catch {
      // Silently fail
    }
  },
}));

/**
 * Persist user + assistant messages to the chat DB.
 * Creates a new ChatSession if none exists for this widget conversation.
 * Returns the DB session ID (created or existing).
 */
async function _persistMessages(
  appId: AppId,
  dbSessionId: string | null,
  userContent: string,
  assistantContent: string,
  metadata: Record<string, unknown>,
): Promise<string | null> {
  try {
    let sessionId = dbSessionId;

    // Create DB session on first message
    if (!sessionId) {
      // Generate a title from the first user message (truncated)
      const title = userContent.length > 60 ? userContent.slice(0, 57) + '...' : userContent;
      const session = await chatSessionsRepository.create(appId, {
        userId: '',
        title,
        status: 'active',
      });
      sessionId = session.id;
    }

    // Persist user message
    await chatMessagesRepository.create(appId, {
      sessionId,
      role: 'user',
      content: userContent,
      status: 'complete',
      createdAt: new Date(),
    });

    // Persist assistant message with metadata
    await chatMessagesRepository.create(appId, {
      sessionId,
      role: 'assistant',
      content: assistantContent,
      metadata: metadata as any,
      status: 'complete',
      createdAt: new Date(),
    });

    return sessionId;
  } catch (err) {
    // Don't break the chat if persistence fails
    console.warn('Failed to persist chat messages:', err);
    return null;
  }
}
