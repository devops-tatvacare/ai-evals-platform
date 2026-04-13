import { create } from 'zustand';
import { getBuilderSession, getChatDefaults, streamChatMessage } from './api';
import { chatSessionsRepository, chatMessagesRepository } from '@/services/api/chatApi';
import type { AppId } from '@/types';
import type { ChatDefaults, ChatProvider, ChartData, ToolCallBadgeData, WidgetMessage, WidgetView, WidgetSessionSummary } from './types';
import { buildSaveTemplatePrompt, upsertToolCall } from './chatWidgetHelpers';

let msgCounter = 0;
const nextId = () => `msg_${++msgCounter}`;

// ── Session pointer persistence (survives page refresh) ─────────────
// Only stores a tiny pointer — messages reload from the DB on restore.

const SESSION_STORAGE_KEY = 'sherlock-active-session';

interface PersistedPointer {
  sessionId: string;
  dbSessionId: string;
  provider: ChatProvider;
  appId: string;
  open: boolean;
}

function savePointer(pointer: PersistedPointer | null): void {
  if (pointer) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(pointer));
  } else {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function loadPointer(): PersistedPointer | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.sessionId && parsed?.dbSessionId && parsed?.provider && parsed?.appId) {
      return parsed as PersistedPointer;
    }
    return null;
  } catch {
    return null;
  }
}

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

  // Streaming state — separate from messages[] to avoid per-delta re-renders
  streamingContent: string;
  streamingToolCalls: ToolCallBadgeData[];
  streamingChart: ChartData | null;

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

  // Restore from sessionStorage on mount
  restoreSession: (currentAppId: string) => Promise<void>;

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

  // ── Streaming (lives outside messages[] to avoid per-delta re-renders) ──
  streamingContent: '',
  streamingToolCalls: [],
  streamingChart: null,

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

      const resolvedProvider = builderSession?.provider ?? get().provider;
      set({
        dbSessionId: sessionId,
        sessionId: builderSession?.sessionId ?? sessionId,
        provider: resolvedProvider,
        locked: !!builderSession,
        messages: widgetMessages,
        view: 'chat',
      });
      if (resolvedProvider) {
        savePointer({
          sessionId: builderSession?.sessionId ?? sessionId,
          dbSessionId: sessionId,
          provider: resolvedProvider,
          appId: appId as string,
          open: get().open,
        });
      }
    } catch {
      // If loading fails, just switch to chat view
      set({ view: 'chat' });
    }
  },

  deleteSession: async (appId, sessionId) => {
    try {
      await chatSessionsRepository.delete(appId, sessionId);
      const wasActive = get().dbSessionId === sessionId;
      set((s) => ({
        sessions: s.sessions.filter((ss) => ss.id !== sessionId),
        ...(wasActive
          ? { dbSessionId: null, sessionId: null, messages: [], locked: false }
          : {}),
      }));
      if (wasActive) savePointer(null);
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

    // Add user message + placeholder; streaming content lives in separate fields
    set((s) => ({
      messages: [...s.messages, userMsg],
      status: 'sending',
      locked: true,
      view: 'chat',
      activeToolCall: null,
      streamingContent: '',
      streamingToolCalls: [],
      streamingChart: null,
    }));

    // rAF-buffered content flushing — batches multiple deltas per frame
    let pendingContent = '';
    let rafId: number | null = null;
    const flushContent = () => {
      rafId = null;
      set({ streamingContent: pendingContent });
    };
    const cancelFlush = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    try {
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
              savePointer({
                sessionId: runtimeSession.sessionId,
                dbSessionId: runtimeSession.sessionId,
                provider: runtimeSession.provider,
                appId,
                open: true,
              });
            },
            onToolCallStart: (name) => {
              set((s) => ({
                activeToolCall: name,
                streamingToolCalls: upsertToolCall(s.streamingToolCalls, {
                  name,
                  status: 'running',
                }),
              }));
            },
            onToolCallEnd: (name, summary, detail) => {
              set((s) => ({
                activeToolCall: null,
                streamingToolCalls: upsertToolCall(s.streamingToolCalls, {
                  name,
                  summary,
                  detail: detail ?? null,
                  status: 'done',
                }),
              }));
            },
            onContentDelta: (delta) => {
              pendingContent += delta;
              if (rafId === null) {
                rafId = requestAnimationFrame(flushContent);
              }
            },
            onChart: (chart) => {
              set({ streamingChart: chart });
            },
            onDone: (data) => {
              // Flush any remaining buffered content
              cancelFlush();

              const finalToolCalls: WidgetMessage['toolCalls'] = data.toolCalls.map((tc) => ({
                name: tc.name,
                summary: tc.summary,
                detail: tc.detail ?? null,
                status: 'done' as const,
              }));

              // Commit completed assistant message to messages[]
              const completedMsg: WidgetMessage = {
                id: nextId(),
                role: 'assistant',
                content: pendingContent,
                toolCalls: finalToolCalls,
                composedReport: data.composedReport,
                chart: get().streamingChart ?? undefined,
                status: 'complete',
              };

              set((s) => ({
                status: 'idle',
                activeToolCall: null,
                messages: [...s.messages, completedMsg],
                streamingContent: '',
                streamingToolCalls: [],
                streamingChart: null,
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
      cancelFlush();

      // Commit error message to messages[]
      const errorMsg: WidgetMessage = {
        id: nextId(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Request failed',
        toolCalls: get().streamingToolCalls,
        status: 'error',
      };

      set((s) => ({
        status: 'error',
        locked: false,
        activeToolCall: null,
        messages: [...s.messages, errorMsg],
        streamingContent: '',
        streamingToolCalls: [],
        streamingChart: null,
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

  newChat: () => {
    savePointer(null);
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
      streamingContent: '',
      streamingToolCalls: [],
      streamingChart: null,
    });
  },

  restoreSession: async (currentAppId) => {
    const pointer = loadPointer();
    if (!pointer) return;
    // Only restore if the stored session belongs to the current app
    if (pointer.appId !== currentAppId) return;

    set({ open: pointer.open, provider: pointer.provider });
    await get().selectSession(currentAppId as AppId, pointer.dbSessionId);
  },

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
