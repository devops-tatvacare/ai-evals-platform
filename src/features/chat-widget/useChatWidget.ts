import { create } from 'zustand';
import type { StateCreator } from 'zustand';
import { cancelChatTurn, getBuilderSession, getChatDefaults, streamChatMessage } from './api';
import { CHAT_SESSION_SOURCE, chatSessionsRepository } from '@/services/api/chatApi';
import { notificationService } from '@/services/notifications';
import type { AppId } from '@/types';
import type {
  Artifact,
  BlueprintPart,
  BuilderSessionData,
  ChatDefaults,
  ChatProvider,
  ChartPart,
  MessagePart,
  SaveToastPart,
  TerminalStatus,
  ToolCallDetailData,
  ToolCallPart,
  TurnUsage,
  WidgetMessage,
  WidgetSessionSummary,
  WidgetView,
} from './types';
import {
  appendTextPart,
  applyArtifactToParts,
  isArtifact,
  jobBadgeFromOutcome,
  mergeTerminalText,
  partsFromStoredMessage,
  replaceOrAppendPart,
  shouldApplyRuntimeSeq,
  upsertJobBadgePart,
  upsertToolPart,
} from './chatWidgetHelpers';

let msgCounter = 0;
const nextId = () => `msg_${++msgCounter}`;

const SESSION_STORAGE_KEY = 'sherlock-active-session';
const WIDGET_OPEN_KEY = 'sherlock-widget-open';
const WIDGET_LAYOUT_KEY = 'sherlock-widget-layout';
const STREAM_FLUSH_MS = 50;
const SEND_TIMEOUT_MS = 60_000;

interface PersistedPointer {
  sessionId: string;
  provider: ChatProvider;
  appId: string;
  open: boolean;
}

function saveOpenState(open: boolean): void {
  try {
    localStorage.setItem(WIDGET_OPEN_KEY, JSON.stringify(open));
  } catch {
    // storage may be unavailable (private mode, quota); fall through silently
  }
}

function loadOpenState(): boolean {
  try {
    const raw = localStorage.getItem(WIDGET_OPEN_KEY);
    if (raw !== null) return JSON.parse(raw) === true;
    // One-time migration from earlier sessionStorage-based implementation.
    const legacy = sessionStorage.getItem(WIDGET_OPEN_KEY);
    return legacy ? JSON.parse(legacy) === true : false;
  } catch {
    return false;
  }
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
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.sessionId && parsed?.provider && parsed?.appId) {
      return parsed as PersistedPointer;
    }
  } catch {
    return null;
  }
  return null;
}

function storedMessageToWidgetMessage(message: BuilderSessionData['messages'][number]): WidgetMessage {
  const metadata = (message.metadata ?? null) as Record<string, unknown> | null;
  const parts = partsFromStoredMessage(message.content, metadata as never);
  const terminalStatus = (metadata?.terminalStatus as TerminalStatus | undefined) ?? undefined;

  return {
    id: message.id,
    role: message.role,
    parts: parts.length > 0 ? parts : appendTextPart([], message.content || message.errorMessage || ''),
    status: message.status === 'error' ? 'error' : 'complete',
    terminalStatus,
  };
}

interface ChatWidgetStore {
  open: boolean;
  view: WidgetView;
  pendingPrompt: string | null;
  sessionId: string | null;
  dbSessionId: string | null;
  activeTurnId: string | null;
  provider: ChatProvider;
  locked: boolean;
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  lastAppliedSeq: number;
  streamingParts: MessagePart[];
  streamingStatus: string | null;
  sessions: WidgetSessionSummary[];
  sessionsLoaded: boolean;
  defaults: ChatDefaults | null;

  toggle: () => void;
  setView: (v: WidgetView) => void;
  openWithPrompt: (prompt: string, appId: string) => void;
  consumePendingPrompt: () => string | null;
  loadSessions: (appId: AppId) => Promise<void>;
  selectSession: (appId: AppId, sessionId: string) => Promise<void>;
  deleteSession: (appId: AppId, sessionId: string) => Promise<void>;
  send: (text: string, appId: string) => Promise<void>;
  resumeActiveTurn: (appId: string) => Promise<void>;
  retryLastMessage: (appId: string) => Promise<void>;
  stopActiveTurn: (appId: string) => Promise<void>;
  newChat: () => void;
  restoreSession: (currentAppId: string) => Promise<void>;
  loadDefaults: () => Promise<void>;
  appendMessagePart: (messageId: string, part: MessagePart) => void;
  updateMessagePart: (messageId: string, matcher: (part: MessagePart) => boolean, next: MessagePart) => void;
  /** Abort any in-flight stream (new chat, app switch, sign-out). */
  abortActiveStream: () => void;
  /** Clear all chat-widget state + persisted keys. Called on user sign-out. */
  resetForSignOut: () => void;
}

/** In-flight stream controller, kept outside React state so callers can abort synchronously. */
let activeAbortController: AbortController | null = null;

type RuntimeApplier = {
  onToolCallStart: (event: { seq: number; toolCallId: string; toolName: string; briefSummary?: string }) => void;
  onToolCallEnd: (event: {
    seq: number;
    toolCallId: string;
    toolName: string;
    summary?: string;
    detail?: ToolCallDetailData | null;
    durationMs?: number;
    rowCount?: number;
    evidenceCount?: number;
    routing?: import('./types').SpecialistRoutingTelemetry;
    // Phase 7 audit fix (Gap 4): the §6.2 envelope projection the backend
    // emits on specialist_finished. Carries ``job`` end-to-end so the widget
    // can render a live pending-job badge (Gap 5).
    outcome?: {
      kind?: string;
      capability?: string;
      reason_code?: string | null;
      job?: { id?: string; status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' };
      artifact?: { type?: string; contract?: string; extras?: Record<string, unknown> };
    };
  }) => void;
  onContentDelta: (event: { seq: number; delta: string }) => void;
  onChart: (event: ChartPart & { seq: number }) => void;
  onBlueprint: (event: BlueprintPart & { seq: number }) => void;
  onSaveResult: (event: { seq: number; variant: SaveToastPart['variant']; id: string; title: string; subtitle?: string; linkText?: string; linkHref: string }) => void;
  onStatus: (event: { seq?: number; text: string }) => void;
  onDone: (event: {
    seq: number;
    terminalStatus?: TerminalStatus;
    content?: string;
    toolCalls: Array<{
      toolCallId?: string;
      name: string;
      summary?: string;
      detail?: ToolCallDetailData | null;
      // Phase 7 audit fix (Gap 4): envelope projection persisted alongside
      // each tool call so ``partsFromStoredMessage`` can rehydrate a
      // ``JobBadgePart`` after reload/replay (Gap 5).
      outcome?: {
        kind?: string;
        capability?: string;
        reason_code?: string | null;
        job?: { id?: string; status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' };
        artifact?: { type?: string; contract?: string; extras?: Record<string, unknown> };
      };
    }>;
    artifacts?: Artifact[] | null;
    usage?: TurnUsage;
  }) => void;
  onError: (event: { seq?: number; terminalStatus?: Extract<TerminalStatus, 'error' | 'interrupted'>; message: string; content?: string }) => void;
};

function createRuntimeApplier(
  set: Parameters<StateCreator<ChatWidgetStore>>[0],
  get: Parameters<StateCreator<ChatWidgetStore>>[1],
  resolveSend?: () => void,
  rejectSend?: (error: Error) => void,
): RuntimeApplier {
  let pendingParts = get().streamingParts;
  let flushTimer: number | null = null;

  const flush = () => {
    flushTimer = null;
    set({ streamingParts: pendingParts });
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = window.setTimeout(flush, STREAM_FLUSH_MS);
  };

  const commitParts = (parts: MessagePart[]) => {
    pendingParts = parts;
    scheduleFlush();
  };

  const applySequencedEvent = (seq: number | undefined, apply: () => void) => {
    if (typeof seq === 'number') {
      const currentSeq = get().lastAppliedSeq;
      if (!shouldApplyRuntimeSeq(currentSeq, seq)) {
        return;
      }
      set({ lastAppliedSeq: seq });
    }
    apply();
  };

  const finalizeAssistantMessage = (
    parts: MessagePart[],
    terminalStatus: TerminalStatus | undefined,
    status: WidgetMessage['status'],
    usage?: TurnUsage,
  ) => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    pendingParts = [];
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: nextId(),
          role: 'assistant',
          parts,
          status,
          terminalStatus,
          ...(usage ? { usage } : {}),
        },
      ],
      streamingParts: [],
      streamingStatus: null,
      status: status === 'error' ? 'error' : 'idle',
    }));
  };

  return {
    onToolCallStart: (event) => {
      applySequencedEvent(event.seq, () => {
        set({ streamingStatus: null });
        commitParts(upsertToolPart(pendingParts, {
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          briefSummary: event.briefSummary,
          state: 'executing',
        }));
      });
    },
    onToolCallEnd: (event) => {
      applySequencedEvent(event.seq, () => {
        let next = upsertToolPart(pendingParts, {
          type: 'tool-call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          state: event.detail?.error ? 'error' : 'completed',
          summary: typeof event.summary === 'string' ? event.summary : undefined,
          detail: event.detail ?? null,
          durationMs: event.durationMs ?? (typeof event.detail?.executionMs === 'number' ? event.detail.executionMs : undefined),
          rowCount: event.rowCount,
          evidenceCount: event.evidenceCount,
          routing: event.routing,
        });
        // Phase 7 audit fix (Gap 5): if the tool submitted a platform
        // job, emit a ``JobBadgePart`` so the widget renders a live badge
        // on the same assistant message.
        const badge = jobBadgeFromOutcome(
          event.outcome as import('./types').StoredToolCallOutcome | undefined,
          event.toolName,
          typeof event.summary === 'string' ? event.summary : undefined,
        );
        if (badge) {
          next = upsertJobBadgePart(next, badge);
        }
        commitParts(next);
      });
    },
    onContentDelta: (event) => {
      applySequencedEvent(event.seq, () => {
        if (get().streamingStatus !== null) {
          set({ streamingStatus: null });
        }
        commitParts(appendTextPart(pendingParts, event.delta));
      });
    },
    onStatus: (event) => {
      applySequencedEvent(event.seq, () => {
        set({ streamingStatus: event.text });
      });
    },
    onChart: (event) => {
      applySequencedEvent(event.seq, () => {
        const chartPart: ChartPart = {
          type: 'chart',
          payload: event.payload,
          saved: event.saved,
          chartId: event.chartId,
        };
        commitParts(replaceOrAppendPart(
          pendingParts,
          (part): part is ChartPart => part.type === 'chart',
          chartPart,
        ));
      });
    },
    onBlueprint: (event) => {
      applySequencedEvent(event.seq, () => {
        const blueprint: BlueprintPart = {
          type: event.type,
          name: event.name,
          sections: event.sections,
          saved: event.saved,
          blueprintId: event.blueprintId,
        };
        commitParts(replaceOrAppendPart(
          pendingParts,
          (part): part is BlueprintPart => part.type === 'blueprint',
          blueprint,
        ));
      });
    },
    onSaveResult: (event) => {
      applySequencedEvent(event.seq, () => {
        const toast: SaveToastPart = {
          type: 'save-toast',
          variant: event.variant,
          title: event.variant === 'chart'
            ? 'Chart saved'
            : event.variant === 'dashboard'
              ? 'Dashboard created'
              : 'Blueprint saved',
          subtitle: event.subtitle ?? event.title,
          linkText: event.linkText ?? (event.variant === 'dashboard' ? 'Open' : event.variant === 'blueprint' ? 'Use in wizard' : 'View'),
          linkHref: event.linkHref,
        };
        commitParts([...pendingParts, toast]);
      });
    },
    onDone: (event) => {
      applySequencedEvent(event.seq, () => {
        let finalParts = [...pendingParts];

        for (const toolCall of event.toolCalls ?? []) {
          // See chatWidgetHelpers.partsFromStoredMessage: the wire contract
          // allows ``toolCallId`` to be absent while the replay shim in
          // docs/plans/sherlock-shim-ledger.md is alive. Drop any entry
          // without one so the dedup by ``toolCallId`` stays consistent.
          if (!toolCall.toolCallId) {
            continue;
          }
          // 2026-05-10 fix: build the patch WITHOUT including
          // `durationMs: undefined` when no value is available. The
          // upsertToolPart spread merges `{...existing, ...next}` so an
          // explicit-undefined key would clobber the duration set live
          // by `onToolCallEnd` from the `specialist_finished` event.
          const reconciledDuration =
            typeof toolCall.detail?.executionMs === 'number' ? toolCall.detail.executionMs : undefined;
          const reconciledPart: ToolCallPart = {
            type: 'tool-call',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.name,
            state: toolCall.detail?.error ? 'error' : 'completed',
            summary: toolCall.summary,
            detail: toolCall.detail ?? null,
            ...(reconciledDuration !== undefined ? { durationMs: reconciledDuration } : {}),
          };
          finalParts = upsertToolPart(finalParts, reconciledPart);
          // Phase 7 audit fix (Gap 5): rehydrate a ``JobBadgePart`` from
          // the persisted envelope ``outcome.job`` so the final message
          // carries the same badge that was shown during streaming.
          const badge = jobBadgeFromOutcome(
            toolCall.outcome as import('./types').StoredToolCallOutcome | undefined,
            toolCall.name,
            toolCall.summary,
          );
          if (badge) {
            finalParts = upsertJobBadgePart(finalParts, badge);
          }
        }

        for (const artifact of event.artifacts ?? []) {
          if (isArtifact(artifact)) {
            finalParts = applyArtifactToParts(finalParts, artifact);
          }
        }
        finalParts = mergeTerminalText(finalParts, event.content);
        finalizeAssistantMessage(finalParts, event.terminalStatus ?? 'done', 'complete', event.usage);
        activeAbortController = null;
        set({ activeTurnId: null });
        resolveSend?.();
      });
    },
    onError: (event) => {
      applySequencedEvent(event.seq, () => {
        let finalParts = [...pendingParts];
        finalParts = mergeTerminalText(finalParts, event.content);
        finalParts = appendTextPart(finalParts, finalParts.length > 0 ? `\n\n${event.message}` : event.message);
        finalizeAssistantMessage(finalParts, event.terminalStatus ?? 'error', 'error');
        activeAbortController = null;
        set({ activeTurnId: null });
        rejectSend?.(Object.assign(new Error(event.message), { terminalStatus: event.terminalStatus, content: event.content }));
      });
    },
  };
}

export const useChatWidgetStore = create<ChatWidgetStore>((set, get) => ({
  open: loadOpenState(),
  view: 'chat',
  pendingPrompt: null,
  sessionId: null,
  dbSessionId: null,
  activeTurnId: null,
  provider: 'openai',
  locked: false,
  messages: [],
  status: 'idle',
  lastAppliedSeq: 0,
  streamingParts: [],
  streamingStatus: null,
  sessions: [],
  sessionsLoaded: false,
  defaults: null,

  toggle: () => {
    const next = !get().open;
    set({ open: next });
    saveOpenState(next);
    const pointer = loadPointer();
    if (pointer) {
      savePointer({ ...pointer, open: next });
    }
  },
  setView: (v) => set({ view: v }),
  openWithPrompt: (prompt) => {
    set({ open: true, view: 'chat', pendingPrompt: prompt });
    saveOpenState(true);
  },
  consumePendingPrompt: () => {
    const prompt = get().pendingPrompt;
    if (prompt) {
      set({ pendingPrompt: null });
    }
    return prompt;
  },

  loadSessions: async (appId) => {
    try {
      const sessions = await chatSessionsRepository.getAll(appId, CHAT_SESSION_SOURCE.sherlock);
      set({
        sessions: sessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          status: session.status,
        })),
        sessionsLoaded: true,
      });
    } catch {
      set({ sessionsLoaded: true });
    }
  },

  selectSession: async (appId, sessionId) => {
    try {
      const snapshot = await getBuilderSession(appId, sessionId);
      const messages = snapshot.messages.map(storedMessageToWidgetMessage);
      const isActive = snapshot.currentTurnStatus === 'active' || snapshot.currentTurnStatus === 'queued';
      const currentOpen = get().open;

      set({
        view: 'chat',
        sessionId: snapshot.sessionId,
        dbSessionId: snapshot.sessionId,
        activeTurnId: isActive ? snapshot.activeTurnId ?? null : null,
        provider: 'openai',
        locked: true,
        messages,
        lastAppliedSeq: 0,
        status: isActive ? 'sending' : 'idle',
        streamingParts: [],
        streamingStatus: null,
      });

      savePointer({
        sessionId: snapshot.sessionId,
        provider: snapshot.provider,
        appId,
        open: currentOpen,
      });

      if (isActive && snapshot.activeTurnId) {
        await get().resumeActiveTurn(appId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not load Sherlock session: ${message}`);
      savePointer(null);
      set({
        view: 'chat',
        sessionId: null,
        dbSessionId: null,
        activeTurnId: null,
        locked: false,
        messages: [],
        status: 'idle',
        streamingParts: [],
        streamingStatus: null,
      });
    }
  },

  deleteSession: async (appId, sessionId) => {
    try {
      await chatSessionsRepository.delete(appId, sessionId);
      const wasActive = get().sessionId === sessionId;
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== sessionId),
        ...(wasActive
          ? {
              sessionId: null,
              dbSessionId: null,
              activeTurnId: null,
              messages: [],
              streamingParts: [],
      streamingStatus: null,
              locked: false,
              status: 'idle',
              lastAppliedSeq: 0,
            }
          : {}),
      }));
      if (wasActive) {
        savePointer(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not delete Sherlock session: ${message}`);
    }
  },

  send: async (text, appId) => {
    const { provider, defaults, sessionId } = get();
    if (!defaults) {
      return;
    }

    const turnId = crypto.randomUUID();
    const model = defaults[provider].model;
    const userMessage: WidgetMessage = {
      id: nextId(),
      role: 'user',
      parts: [{ type: 'text', content: text }],
      status: 'complete',
    };

    set((state) => ({
      open: true,
      view: 'chat',
      messages: [...state.messages, userMessage],
      status: 'sending',
      locked: true,
      activeTurnId: turnId,
      streamingParts: [],
      streamingStatus: null,
    }));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let abortController: AbortController | null = null;
      activeAbortController?.abort();
      activeAbortController = null;

      const finishResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      };

      const finishReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      };

      // Single applier shared between timeout and stream — no racing second applier.
      const applier = createRuntimeApplier(set, get, finishResolve, finishReject);

      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        // Abort the stream so no more events arrive after timeout.
        abortController?.abort();
        // Use the SAME applier to finalize — no second applier.
        applier.onError({
          terminalStatus: 'error',
          message: 'Sherlock timed out before the turn completed',
        });
      }, SEND_TIMEOUT_MS);

      streamChatMessage(
        {
          appId,
          sessionId,
          turnId,
          operation: 'send',
          message: text,
          model,
        },
        {
          onSessionId: (runtimeSession) => {
            set({
              sessionId: runtimeSession.sessionId,
              dbSessionId: runtimeSession.sessionId,
              provider: runtimeSession.provider,
              lastAppliedSeq: runtimeSession.lastEventSeq ?? get().lastAppliedSeq,
              locked: true,
            });
            savePointer({
              sessionId: runtimeSession.sessionId,
              provider: runtimeSession.provider,
              appId,
              open: true,
            });
          },
          onEntityRecognition: () => {
            // Recognition is informative but not user-visible in the widget.
          },
          onToolCallStart: applier.onToolCallStart,
          onToolCallEnd: applier.onToolCallEnd,
          onContentDelta: applier.onContentDelta,
          onChart: (event) => applier.onChart({ type: 'chart', payload: event.payload, saved: event.saved, chartId: event.chartId, seq: event.seq }),
          onBlueprint: applier.onBlueprint,
          onSaveResult: applier.onSaveResult,
          onStatus: applier.onStatus,
          onDone: (event) => applier.onDone(event),
          onError: applier.onError,
        },
      ).then((controller) => {
        abortController = controller;
        activeAbortController = controller;
      }).catch((error) => finishReject(error instanceof Error ? error : new Error(String(error))));
    }).catch(() => {
      // State is already committed by the runtime applier.
    }).finally(() => {
      activeAbortController = null;
    });
  },

  resumeActiveTurn: async (appId) => {
    const { sessionId, activeTurnId, provider, defaults } = get();
    if (!sessionId || !activeTurnId || !defaults) {
      return;
    }

    const applier = createRuntimeApplier(set, get);
    set({ status: 'sending', locked: true });

    const controller = await streamChatMessage(
      {
        appId,
        sessionId,
        turnId: activeTurnId,
        operation: 'resume',
        model: defaults[provider].model,
      },
      {
        onSessionId: (runtimeSession) => {
          set({
            sessionId: runtimeSession.sessionId,
            dbSessionId: runtimeSession.sessionId,
            provider: runtimeSession.provider,
            lastAppliedSeq: runtimeSession.lastEventSeq ?? get().lastAppliedSeq,
            locked: true,
          });
        },
        onEntityRecognition: () => {
          // Recognition is informative but not user-visible in the widget.
        },
        onToolCallStart: applier.onToolCallStart,
        onToolCallEnd: applier.onToolCallEnd,
        onContentDelta: applier.onContentDelta,
        onChart: (event) => applier.onChart({ type: 'chart', payload: event.payload, saved: event.saved, chartId: event.chartId, seq: event.seq }),
        onBlueprint: applier.onBlueprint,
        onSaveResult: applier.onSaveResult,
        onStatus: applier.onStatus,
        onDone: (event) => applier.onDone(event),
        onError: applier.onError,
      },
    );
    activeAbortController = controller;
  },

  retryLastMessage: async (appId) => {
    const lastUserMessage = [...get().messages].reverse().find((message) => message.role === 'user');
    const textPart = lastUserMessage?.parts.find((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text');
    if (!textPart) {
      return;
    }
    await get().send(textPart.content, appId);
  },

  stopActiveTurn: async (appId) => {
    const { sessionId, activeTurnId, status } = get();
    if (!sessionId || !activeTurnId || status !== 'sending') {
      return;
    }
    set({ streamingStatus: 'Stopping…', locked: true });
    try {
      const response = await cancelChatTurn(appId, sessionId, activeTurnId);
      if (response.result === 'already_terminal') {
        await get().selectSession(appId as AppId, sessionId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notificationService.error(`Could not stop Sherlock turn: ${message}`);
      set({ streamingStatus: null });
    }
  },

  abortActiveStream: () => {
    activeAbortController?.abort();
    activeAbortController = null;
  },

  newChat: () => {
    activeAbortController?.abort();
    activeAbortController = null;
    savePointer(null);
    set({
      sessionId: null,
      dbSessionId: null,
      activeTurnId: null,
      provider: 'openai',
      locked: false,
      messages: [],
      status: 'idle',
      lastAppliedSeq: 0,
      pendingPrompt: null,
      view: 'chat',
      sessionsLoaded: false,
      streamingParts: [],
      streamingStatus: null,
    });
  },

  restoreSession: async (currentAppId) => {
    const pointer = loadPointer();
    if (!pointer || pointer.appId !== currentAppId) {
      // No session to restore, but honour persisted open/close state
      set({ open: loadOpenState() });
      return;
    }

    set({ open: pointer.open, provider: pointer.provider });
    saveOpenState(pointer.open);
    await get().selectSession(currentAppId as AppId, pointer.sessionId);
  },

  loadDefaults: async () => {
    try {
      const defaults = await getChatDefaults();
      set({ defaults: { openai: defaults.openai } });
    } catch {
      // ignore
    }
  },

  appendMessagePart: (messageId, part) => {
    set((state) => ({
      messages: state.messages.map((message) => (
        message.id === messageId
          ? { ...message, parts: [...message.parts, part] }
          : message
      )),
    }));
  },

  resetForSignOut: () => {
    try {
      localStorage.removeItem(WIDGET_OPEN_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(WIDGET_LAYOUT_KEY);
    } catch {
      // storage may be unavailable; proceed
    }
    get().abortActiveStream?.();
    set({
      open: false,
      view: 'chat',
      pendingPrompt: null,
      sessionId: null,
      dbSessionId: null,
      activeTurnId: null,
      provider: 'openai',
      locked: false,
      messages: [],
      status: 'idle',
      lastAppliedSeq: 0,
      streamingParts: [],
      streamingStatus: null,
      sessions: [],
      sessionsLoaded: false,
    });
  },

  updateMessagePart: (messageId, matcher, next) => {
    set((state) => ({
      messages: state.messages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const index = message.parts.findIndex(matcher);
        if (index === -1) {
          return message;
        }

        const parts = [...message.parts];
        parts[index] = next;
        return { ...message, parts };
      }),
    }));
  },
}));
