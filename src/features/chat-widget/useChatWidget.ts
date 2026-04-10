import { create } from 'zustand';
import { sendChatMessage, getChatDefaults } from './api';
import type { ChatDefaults, ChatProvider, WidgetMessage } from './types';

let msgCounter = 0;
const nextId = () => `msg_${++msgCounter}`;

interface ChatWidgetStore {
  // UI
  open: boolean;
  pendingPrompt: string | null;
  toggle: () => void;
  openWithPrompt: (prompt: string, appId: string) => void;
  consumePendingPrompt: () => string | null;

  // Session
  sessionId: string | null;
  provider: ChatProvider | null;
  locked: boolean;
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  activeToolCall: string | null;

  // Actions
  setProvider: (p: ChatProvider) => void;
  send: (text: string, appId: string) => Promise<void>;
  reset: () => void;

  // Defaults
  defaults: ChatDefaults | null;
  loadDefaults: () => Promise<void>;
}

export const useChatWidgetStore = create<ChatWidgetStore>((set, get) => ({
  // UI
  open: false,
  pendingPrompt: null,
  toggle: () => set((s) => ({ open: !s.open })),
  openWithPrompt: (prompt, appId) => {
    const { provider, defaults } = get();
    set({ open: true, pendingPrompt: prompt });
    // If provider + defaults ready, send immediately
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

  // Session
  sessionId: null,
  provider: null,
  locked: false,
  messages: [],
  status: 'idle',
  activeToolCall: null,

  // Actions
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
    }));

    try {
      const response = await sendChatMessage({
        appId,
        sessionId,
        message: text,
        provider,
        model,
      });

      set((s) => ({
        sessionId: response.sessionId,
        status: 'idle',
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: response.content,
                toolCalls: response.toolCalls.map((tc) => ({
                  name: tc.name,
                  summary: tc.summary,
                  status: 'done' as const,
                })),
                composedReport: response.composedReport,
                status: 'complete' as const,
              }
            : m,
        ),
      }));
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

  reset: () =>
    set({
      sessionId: null,
      locked: false,
      messages: [],
      status: 'idle',
      activeToolCall: null,
      pendingPrompt: null,
    }),

  // Defaults
  defaults: null,
  loadDefaults: async () => {
    try {
      const defaults = await getChatDefaults();
      set({ defaults });
    } catch {
      // Silently fail — widget will show error state
    }
  },
}));
