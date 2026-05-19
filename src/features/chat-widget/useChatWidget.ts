/** Sherlock chat-widget orchestrator. */
import { create } from 'zustand';

import { CHAT_SESSION_SOURCE, chatSessionsRepository } from '@/services/api/chatApi';
import { notificationService } from '@/services/notifications';
import { queryClient as appQueryClient } from '@/features/orchestration/queries/queryClient';
import {
  streamTurn,
  type TurnStreamControls,
} from '@/features/sherlock/sse';
import { useStreamStore } from '@/features/sherlock/streamStore';
import type { AppId } from '@/types';

import { cancelChatTurn, getBuilderSession } from './api';
import type { WidgetSessionSummary, WidgetView } from './types';

const SESSION_STORAGE_KEY = 'sherlock-active-session';
const WIDGET_OPEN_KEY = 'sherlock-widget-open';
const WIDGET_LAYOUT_KEY = 'sherlock-widget-layout';

interface PersistedPointer {
  sessionId: string;
  appId: string;
  open: boolean;
}

function saveOpenState(open: boolean): void {
  try {
    localStorage.setItem(WIDGET_OPEN_KEY, JSON.stringify(open));
  } catch {
    /* private mode / quota — ignore */
  }
}

function loadOpenState(): boolean {
  try {
    const raw = localStorage.getItem(WIDGET_OPEN_KEY);
    if (raw !== null) return JSON.parse(raw) === true;
    const legacy = sessionStorage.getItem(WIDGET_OPEN_KEY);
    return legacy ? JSON.parse(legacy) === true : false;
  } catch {
    return false;
  }
}

function savePointer(pointer: PersistedPointer | null): void {
  try {
    if (pointer) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(pointer));
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function loadPointer(): PersistedPointer | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPointer>;
    if (parsed?.sessionId && parsed?.appId) {
      return {
        sessionId: parsed.sessionId,
        appId: parsed.appId,
        open: parsed.open === true,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

let activeStream: TurnStreamControls | null = null;
let activeStreamTurnId: string | null = null;

function resumeTurn(opts: { appId: string; sessionId: string; turnId: string }): void {
  activeStream?.abort();
  activeStream = null;
  activeStreamTurnId = opts.turnId;
  activeStream = streamTurn({
    appId: opts.appId,
    sessionId: opts.sessionId,
    turnId: opts.turnId,
    operation: 'resume',
    model: 'server-resolved',
    queryClient: appQueryClient,
    onTerminal: (payload) => {
      if (activeStreamTurnId !== opts.turnId) return;
      useChatWidgetStore.setState({
        status: payload.status === 'error' ? 'error' : 'idle',
        activeTurnId: null,
        errorMessage:
          payload.status === 'error' ? payload.lastError ?? 'Sherlock errored.' : null,
      });
      activeStream = null;
      activeStreamTurnId = null;
    },
  });
  void activeStream.done.catch(() => {});
}

interface ChatWidgetStore {
  open: boolean;
  view: WidgetView;
  pendingPrompt: string | null;
  sessionId: string | null;
  activeTurnId: string | null;
  status: 'idle' | 'sending' | 'error';
  errorMessage: string | null;
  sessions: WidgetSessionSummary[];
  sessionsLoaded: boolean;
  lastUserPrompt: string | null;

  toggle(): void;
  setView(v: WidgetView): void;
  openWithPrompt(prompt: string, appId: string): void;
  consumePendingPrompt(): string | null;

  loadSessions(appId: AppId): Promise<void>;
  selectSession(appId: AppId, sessionId: string): Promise<void>;
  deleteSession(appId: AppId, sessionId: string): Promise<void>;

  send(text: string, appId: string): Promise<void>;
  retryLastMessage(appId: string): Promise<void>;
  stopActiveTurn(appId: string): Promise<void>;

  newChat(): void;
  restoreSession(currentAppId: string): Promise<void>;

  abortActiveStream(): void;
  resetForSignOut(): void;
}

export const useChatWidgetStore = create<ChatWidgetStore>((set, get) => ({
  open: loadOpenState(),
  view: 'chat',
  pendingPrompt: null,
  sessionId: null,
  activeTurnId: null,
  status: 'idle',
  errorMessage: null,
  sessions: [],
  sessionsLoaded: false,
  lastUserPrompt: null,

  toggle: () => {
    const next = !get().open;
    set({ open: next });
    saveOpenState(next);
    const pointer = loadPointer();
    if (pointer) savePointer({ ...pointer, open: next });
  },

  setView: (v) => set({ view: v }),

  openWithPrompt: (prompt) => {
    set({ open: true, view: 'chat', pendingPrompt: prompt });
    saveOpenState(true);
  },

  consumePendingPrompt: () => {
    const prompt = get().pendingPrompt;
    if (prompt) set({ pendingPrompt: null });
    return prompt;
  },

  loadSessions: async (appId) => {
    try {
      const sessions = await chatSessionsRepository.getAll(appId, CHAT_SESSION_SOURCE.sherlock);
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
    activeStream?.abort();
    activeStream = null;
    const prior = get().sessionId;
    if (prior && prior !== sessionId) useStreamStore.getState().reset(prior);

    try {
      const snapshot = await getBuilderSession(appId, sessionId);
      const isActive =
        snapshot.currentTurnStatus === 'active' || snapshot.currentTurnStatus === 'queued';

      set({
        view: 'chat',
        sessionId: snapshot.sessionId,
        activeTurnId: isActive ? snapshot.activeTurnId ?? null : null,
        status: isActive ? 'sending' : 'idle',
        errorMessage: null,
        lastUserPrompt: null,
      });

      savePointer({ sessionId: snapshot.sessionId, appId, open: get().open });

      if (isActive && snapshot.activeTurnId) {
        resumeTurn({ appId, sessionId: snapshot.sessionId, turnId: snapshot.activeTurnId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not load Sherlock session: ${message}`);
      savePointer(null);
      set({
        view: 'chat',
        sessionId: null,
        activeTurnId: null,
        status: 'idle',
        errorMessage: null,
      });
    }
  },

  deleteSession: async (appId, sessionId) => {
    try {
      await chatSessionsRepository.delete(appId, sessionId);
      const wasActive = get().sessionId === sessionId;
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        ...(wasActive
          ? {
              sessionId: null,
              activeTurnId: null,
              status: 'idle' as const,
              errorMessage: null,
              lastUserPrompt: null,
            }
          : {}),
      }));
      if (wasActive) {
        useStreamStore.getState().reset(sessionId);
        savePointer(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not delete Sherlock session: ${message}`);
    }
  },

  send: async (text, appId) => {
    const turnId = crypto.randomUUID();
    activeStream?.abort();
    activeStream = null;
    activeStreamTurnId = turnId;

    set({
      open: true,
      view: 'chat',
      status: 'sending',
      activeTurnId: turnId,
      errorMessage: null,
      lastUserPrompt: text,
    });
    saveOpenState(true);

    activeStream = streamTurn({
      appId,
      sessionId: get().sessionId,
      turnId,
      operation: 'send',
      message: text,
      model: 'server-resolved',
      queryClient: appQueryClient,
      onSession: (session) => {
        // Ignore late session frames from a stream we already aborted; otherwise
        // a quick send/stop/send sequence can let the dead stream clobber the
        // live sessionId.
        if (activeStreamTurnId !== turnId) return;
        set({ sessionId: session.sessionId });
        savePointer({ sessionId: session.sessionId, appId, open: true });
      },
      onTerminal: (payload) => {
        if (activeStreamTurnId !== turnId) return;
        set({
          status: payload.status === 'error' ? 'error' : 'idle',
          activeTurnId: null,
          errorMessage:
            payload.status === 'error' ? payload.lastError ?? 'Sherlock errored.' : null,
        });
        activeStream = null;
        activeStreamTurnId = null;
      },
    });

    await activeStream.done.catch(() => {});
  },

  retryLastMessage: async (appId) => {
    const prompt = get().lastUserPrompt;
    if (!prompt) return;
    await get().send(prompt, appId);
  },

  stopActiveTurn: async (appId) => {
    const { sessionId, activeTurnId, status } = get();
    if (!sessionId || !activeTurnId || status !== 'sending') return;
    try {
      activeStream?.abort();
      activeStream = null;
      activeStreamTurnId = null;
      await cancelChatTurn(appId, sessionId, activeTurnId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not stop Sherlock turn: ${message}`);
    } finally {
      set({ status: 'idle', activeTurnId: null });
    }
  },

  newChat: () => {
    activeStream?.abort();
    activeStream = null;
    activeStreamTurnId = null;
    const prior = get().sessionId;
    if (prior) useStreamStore.getState().reset(prior);
    savePointer(null);
    set({
      sessionId: null,
      activeTurnId: null,
      status: 'idle',
      errorMessage: null,
      pendingPrompt: null,
      view: 'chat',
      sessionsLoaded: false,
      lastUserPrompt: null,
    });
  },

  restoreSession: async (currentAppId) => {
    const pointer = loadPointer();
    if (!pointer || pointer.appId !== currentAppId) {
      set({ open: loadOpenState() });
      return;
    }
    set({ open: pointer.open });
    saveOpenState(pointer.open);
    await get().selectSession(currentAppId as AppId, pointer.sessionId);
  },

  abortActiveStream: () => {
    activeStream?.abort();
    activeStream = null;
    activeStreamTurnId = null;
  },

  resetForSignOut: () => {
    try {
      localStorage.removeItem(WIDGET_OPEN_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(WIDGET_LAYOUT_KEY);
    } catch {
      /* ignore */
    }
    activeStream?.abort();
    activeStream = null;
    activeStreamTurnId = null;
    useStreamStore.getState().resetAll();
    set({
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
  },
}));
