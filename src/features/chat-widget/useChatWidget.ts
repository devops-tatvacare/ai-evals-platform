import { create } from 'zustand';
import { getBuilderSession, getChatDefaults, streamChatMessage } from './api';
import { chatSessionsRepository, chatMessagesRepository } from '@/services/api/chatApi';
import type { AppId } from '@/types';
import type { ChatDefaults, ChatProvider, WidgetMessage, WidgetView, WidgetSessionSummary } from './types';
import { buildSaveTemplatePrompt, upsertToolCall } from './chatWidgetHelpers';

let msgCounter = 0;
const nextId = () => `msg_${++msgCounter}`;

type StoredWidgetMetadata = {
  toolCalls?: WidgetMessage['toolCalls'];
  composedReport?: WidgetMessage['composedReport'];
  chart?: WidgetMessage['chart'];
};

function readWidgetMetadata(metadata: unknown): StoredWidgetMetadata {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  return metadata as StoredWidgetMetadata;
}

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
  saveComposedReport: (reportName: string, appId: string) => Promise<void>;
  retryLastMessage: (appId: string) => Promise<void>;
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
    void appId;
    set({ open: true, view: 'chat', pendingPrompt: prompt });
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
      const sessions = await chatSessionsRepository.getAll(appId, 'sherlock');
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
      let builderSession = null;
      try {
        builderSession = await getBuilderSession(appId, sessionId);
      } catch {
        builderSession = null;
      }
      const widgetMessages: WidgetMessage[] = dbMessages.map((m) => {
        const metadata = readWidgetMetadata(m.metadata);
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: (metadata.toolCalls ?? []).map((tc) => ({
            name: tc.name,
            summary: tc.summary,
            detail: tc.detail ?? null,
            status: 'done' as const,
          })),
          composedReport: metadata.composedReport ?? null,
          chart: metadata.chart,
          status: 'complete' as const,
        };
      });

      set({
        dbSessionId: sessionId,
        sessionId: builderSession?.sessionId ?? sessionId,
        provider: builderSession?.provider ?? null,
        locked: !!builderSession,
        messages: widgetMessages,
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
    const { provider, defaults, sessionId } = get();
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
      activeToolCall: null,
    }));

    try {
      let finalContent = '';
      let finalToolCalls: WidgetMessage['toolCalls'] = [];

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const rejectOnce = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };

        void streamChatMessage(
          {
            appId,
            sessionId,
            message: text,
            provider,
            model,
          },
          {
            onSessionId: (runtimeSession) => {
              set({
                sessionId: runtimeSession.sessionId,
                dbSessionId: runtimeSession.sessionId,
                provider: runtimeSession.provider,
                locked: true,
              });
            },
            onToolCallStart: (name) => {
              set((s) => ({
                activeToolCall: name,
                messages: s.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: upsertToolCall(m.toolCalls, {
                          name,
                          status: 'running',
                        }),
                      }
                    : m,
                ),
              }));
            },
            onToolCallEnd: (name, summary, detail) => {
              set((s) => ({
                activeToolCall: null,
                messages: s.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: upsertToolCall(m.toolCalls, {
                          name,
                          summary,
                          detail: detail ?? null,
                          status: 'done',
                        }),
                      }
                    : m,
                ),
              }));
            },
            onContentDelta: (delta) => {
              finalContent += delta;
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: finalContent,
                      }
                    : m,
                ),
              }));
            },
            onChart: (chart) => {
              set((s) => ({
                messages: s.messages.map((m) =>
                  m.id === assistantId
                    ? { ...m, chart }
                    : m,
                ),
              }));
            },
            onDone: (data) => {
              finalToolCalls = data.toolCalls.map((tc) => ({
                name: tc.name,
                summary: tc.summary,
                detail: tc.detail ?? null,
                status: 'done' as const,
              }));

              set((s) => ({
                status: 'idle',
                activeToolCall: null,
                messages: s.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: finalContent,
                        toolCalls: finalToolCalls,
                        composedReport: data.composedReport,
                        chart: m.chart,
                        status: 'complete' as const,
                      }
                    : m,
                ),
              }));

              resolveOnce();
            },
            onError: (error) => {
              rejectOnce(new Error(error));
            },
          },
        ).catch((error) => {
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        });
      });
    } catch (err) {
      set((s) => ({
        status: 'error',
        locked: false,
        activeToolCall: null,
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

  saveComposedReport: async (reportName, appId) => {
    const prompt = buildSaveTemplatePrompt(reportName);
    await get().send(prompt, appId);
  },

  retryLastMessage: async (appId) => {
    const lastUserMessage = [...get().messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage) return;
    await get().send(lastUserMessage.content, appId);
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
      sessionsLoaded: false, // force reload on next history view
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
