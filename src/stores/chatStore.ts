/**
 * Chat Store
 * Zustand store for managing Kaira chat state
 */

import { create } from "zustand";
import {
  createAppRecord,
  type AppId,
  type KairaChatSession,
  type KairaChatMessage,
} from "@/types";
import {
  chatSessionsRepository,
  chatMessagesRepository,
} from "@/services/storage";
import { CHAT_SESSION_SOURCE } from "@/services/api/chatApi";
import { kairaChatService } from "@/services/kaira";
import {
  buildStreamRequest,
  processChunk,
  applySessionUpdate,
} from "@/services/kaira/kairaSessionProtocol";
import type {
  KairaSessionState,
  SessionUpdate,
} from "@/services/kaira/kairaSessionProtocol";

interface ChatStoreState {
  // Current session
  currentSessionId: string | null;
  sessions: Record<AppId, KairaChatSession[]>;
  messages: KairaChatMessage[];

  // UI state
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isCreatingSession: boolean;
  isSending: boolean;
  isDeleting: boolean;
  isSessionsLoaded: Record<AppId, boolean>;

  // Abort controller for canceling streams
  abortController: AbortController | null;

  // Actions
  loadSessions: (
    appId: AppId,
    opts?: { userId?: string; chatIdHint?: string },
  ) => Promise<void>;
  selectSession: (appId: AppId, sessionId: string | null) => Promise<void>;
  createSession: (appId: AppId, userId: string) => Promise<KairaChatSession>;
  deleteSession: (appId: AppId, sessionId: string) => Promise<void>;
  sendMessage: (appId: AppId, content: string) => Promise<void>;
  sendMessageStreaming: (appId: AppId, content: string) => Promise<void>;
  cancelStream: () => void;
  clearError: () => void;
  updateSessionTitle: (
    appId: AppId,
    sessionId: string,
    title: string,
  ) => Promise<void>;
  updateMessageMetadata: (
    appId: AppId,
    messageId: string,
    metadata: Partial<KairaChatMessage["metadata"]>,
  ) => Promise<void>;
  reset: () => void;
}

const createSessionsByApp = () => createAppRecord<KairaChatSession[]>(() => []);
const createSessionsLoadedState = () => createAppRecord(() => false);

export const useChatStore = create<ChatStoreState>((set, get) => ({
  currentSessionId: null,
  sessions: createSessionsByApp(),
  messages: [],
  isStreaming: false,
  streamingContent: "",
  error: null,
  isLoadingSessions: false,
  isLoadingMessages: false,
  isCreatingSession: false,
  isSending: false,
  isDeleting: false,
  isSessionsLoaded: createSessionsLoadedState(),
  abortController: null,

  loadSessions: async (
    appId: AppId,
    opts?: { userId?: string; chatIdHint?: string },
  ) => {
    // Skip if already loaded
    if (get().isSessionsLoaded[appId]) {
      return;
    }

    // Pre-fetch app-level evaluators in parallel (fire-and-forget).
    // Mirrors Voice Rx pattern so evaluator data is ready before the
    // user clicks the Evaluators tab, eliminating the flash on first click.
    if (appId === "kaira-bot") {
      import("@/stores/evaluatorsStore").then(({ useEvaluatorsStore }) => {
        useEvaluatorsStore.getState().loadAppEvaluators(appId);
      });
    }

    try {
      set({ isLoadingSessions: true, error: null });

      const sessions = (await chatSessionsRepository.getAll(appId))
        .filter((s) => s.serverSessionId !== CHAT_SESSION_SOURCE.sherlock);

      set((state) => ({
        sessions: {
          ...state.sessions,
          [appId]: sessions,
        },
        isSessionsLoaded: {
          ...state.isSessionsLoaded,
          [appId]: true,
        },
      }));

      // Auto-select first session inline -- no intermediate render exposed to React
      const updatedState = get();
      if (
        opts?.userId &&
        updatedState.sessions[appId].length > 0 &&
        !updatedState.currentSessionId
      ) {
        // Prefer chatIdHint (from URL) if it matches an existing session; fall back to first session
        const targetSessionId = opts?.chatIdHint
          ? (updatedState.sessions[appId].find((s) => s.id === opts.chatIdHint)
              ?.id ?? updatedState.sessions[appId][0].id)
          : updatedState.sessions[appId][0].id;
        set({ currentSessionId: targetSessionId, isLoadingMessages: true });
        try {
          const messages =
            await chatMessagesRepository.getBySession(appId, targetSessionId);
          set({ messages, isLoadingMessages: false });
        } catch {
          set({ messages: [], isLoadingMessages: false });
        }
      }

      // Mark sessions loading complete only after everything (incl. auto-select) is settled
      set({ isLoadingSessions: false });
    } catch (err) {
      console.error("[chatStore] Failed to load chat sessions:", err);
      set((state) => ({
        error: "Failed to load chat sessions",
        isLoadingSessions: false,
        isSessionsLoaded: {
          ...state.isSessionsLoaded,
          [appId]: true,
        },
      }));
    }
  },

  selectSession: async (appId: AppId, sessionId: string | null) => {
    if (!sessionId) {
      set({ currentSessionId: null, messages: [] });
      return;
    }

    // Clear messages immediately to prevent cross-session contamination
    set({
      currentSessionId: sessionId,
      messages: [],
      isLoadingMessages: true,
      error: null,
    });

    try {
      const messages = await chatMessagesRepository.getBySession(appId, sessionId);
      set({
        messages,
        isLoadingMessages: false,
      });
    } catch (err) {
      console.error("Failed to load session messages:", err);
      set({
        currentSessionId: null,
        messages: [],
        error: "Failed to load messages",
        isLoadingMessages: false,
      });
    }
  },

  createSession: async (appId: AppId, userId: string) => {
    // Guard against concurrent session creation - check current state, not closure
    const state = get();
    if (state.isCreatingSession) {
      throw new Error("Session creation already in progress");
    }

    set({ isCreatingSession: true, error: null });

    try {
      // Kaira mints serverSessionId from the first classification chunk.
      const session = await chatSessionsRepository.create(appId, {
        userId,
        title: "New Chat",
        status: "active",
        newSession: true,
      });

      set((state) => ({
        sessions: {
          ...state.sessions,
          [appId]: [session, ...state.sessions[appId]],
        },
        currentSessionId: session.id,
        messages: [],
        isCreatingSession: false,
      }));

      return session;
    } catch (err) {
      console.error("[chatStore] Failed to create session:", err);
      set({
        isCreatingSession: false,
        error: err instanceof Error ? err.message : "Failed to create session",
      });
      throw err;
    }
  },

  deleteSession: async (appId: AppId, sessionId: string) => {
    // Guard against concurrent deletion
    const state = get();
    if (state.isDeleting) {
      throw new Error("Delete already in progress");
    }

    set({ isDeleting: true, error: null });

    try {
      // DB operation first - only update state on success
      await chatSessionsRepository.delete(appId, sessionId);

      set((state) => {
        const newSessions = {
          ...state.sessions,
          [appId]: state.sessions[appId].filter(
            (s) => s.id !== sessionId,
          ),
        };

        // If we deleted the current session, clear it
        const shouldClearCurrent = state.currentSessionId === sessionId;

        return {
          sessions: newSessions,
          currentSessionId: shouldClearCurrent ? null : state.currentSessionId,
          messages: shouldClearCurrent ? [] : state.messages,
          isDeleting: false,
        };
      });
    } catch (err) {
      console.error("Failed to delete session:", err);
      set({
        isDeleting: false,
        error: err instanceof Error ? err.message : "Failed to delete session",
      });
      throw err;
    }
  },

  sendMessage: async (appId: AppId, content: string) => {
    return get().sendMessageStreaming(appId, content);
  },

  sendMessageStreaming: async (appId: AppId, content: string) => {
    // Guard against concurrent sends - check current state
    const state = get();
    if (state.isSending || state.isStreaming) {
      console.warn("Message send already in progress");
      return;
    }

    const { currentSessionId, sessions } = state;

    if (!currentSessionId) {
      set({ error: "No session selected" });
      return;
    }

    const session = sessions[appId].find((s) => s.id === currentSessionId);
    if (!session) {
      set({ error: "Session not found" });
      return;
    }

    // Create abort controller
    const abortController = new AbortController();

    // Create user message
    const userMessage = await chatMessagesRepository.create(appId, {
      sessionId: currentSessionId,
      role: "user",
      content,
      createdAt: new Date(),
      status: "complete",
    });

    // Create streaming assistant message
    const assistantMessage = await chatMessagesRepository.create(appId, {
      sessionId: currentSessionId,
      role: "assistant",
      content: "",
      createdAt: new Date(),
      status: "streaming",
    });

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      isStreaming: true,
      streamingContent: "",
      error: null,
      abortController,
    }));

    try {
      let fullContent = "";
      const metadata: KairaChatMessage["metadata"] = {};
      const streamStartTime = Date.now();

      // Initialize session state from persisted session
      let sessionState: KairaSessionState = {
        userId: session.userId,
        sessionId: session.serverSessionId,
        newSession: session.newSession ?? true,
        _sentinelBuffer: '',
        _inSentinel: false,
      };

      // Build API request via protocol
      const apiRequest = buildStreamRequest(sessionState, content);

      // Capture API request for debugging
      metadata.apiRequest = apiRequest;

      /** Persist a session update to DB + Zustand store. */
      const persistSessionUpdate = async (update: SessionUpdate) => {
        const dbPatch: Partial<KairaChatSession> = {};
        if (update.sessionId !== undefined)
          dbPatch.serverSessionId = update.sessionId;
        if (update.markFirstMessageDone) dbPatch.newSession = false;

        if (Object.keys(dbPatch).length === 0) return;

        await chatSessionsRepository.update(appId, currentSessionId, dbPatch);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId].map((s) =>
              s.id === currentSessionId ? { ...s, ...dbPatch } : s,
            ),
          },
        }));
      };

      for await (const chunk of kairaChatService.streamMessage(
        apiRequest,
        abortController.signal,
      )) {
        const { sessionUpdate, content: chunkContent } = processChunk(
          chunk,
          sessionState,
        );

        // Apply session update (immutable state + persist)
        if (sessionUpdate) {
          sessionState = applySessionUpdate(sessionState, sessionUpdate);
          await persistSessionUpdate(sessionUpdate);
        }

        // Accumulate content
        if (chunkContent.classification) {
          metadata.classification = chunkContent.classification;
        }
        if (chunkContent.message !== undefined) {
          if (chunkContent.streamComplete) {
            // done chunk: overwrite with clean sentinel-free full_response
            fullContent = chunkContent.message;
          } else {
            // token chunk: append stripped fragment
            fullContent += chunkContent.message;
          }
          set({ streamingContent: fullContent });
        }
        if (chunkContent.foodCard) {
          metadata.foodCard = chunkContent.foodCard;
        }
        if (chunkContent.error) {
          throw new Error(chunkContent.error);
        }
      }

      // Calculate processing time
      metadata.processingTime = (Date.now() - streamStartTime) / 1000;

      // Update assistant message with final content
      await chatMessagesRepository.update(appId, assistantMessage.id, {
        content: fullContent,
        status: "complete",
        metadata,
      });

      // Update title if it's still "New Chat"
      if (session.title === "New Chat") {
        const newTitle =
          content.slice(0, 50) + (content.length > 50 ? "..." : "");
        await chatSessionsRepository.update(appId, currentSessionId, {
          title: newTitle,
        });

        set((state) => ({
          sessions: {
            ...state.sessions,
            [appId]: state.sessions[appId].map((s) =>
              s.id === currentSessionId ? { ...s, title: newTitle } : s,
            ),
          },
        }));
      }

      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantMessage.id
            ? {
                ...m,
                content: fullContent,
                status: "complete" as const,
                metadata,
              }
            : m,
        ),
        isStreaming: false,
        streamingContent: "",
        abortController: null,
      }));
    } catch (err) {
      console.error("Streaming error:", err);

      await chatMessagesRepository.update(appId, assistantMessage.id, {
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Streaming failed",
      });

      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantMessage.id
            ? {
                ...m,
                status: "error" as const,
                errorMessage:
                  err instanceof Error ? err.message : "Streaming failed",
              }
            : m,
        ),
        isStreaming: false,
        streamingContent: "",
        error: err instanceof Error ? err.message : "Streaming failed",
        abortController: null,
      }));
    }
  },

  cancelStream: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({
        isStreaming: false,
        streamingContent: "",
        abortController: null,
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  updateSessionTitle: async (
    appId: AppId,
    sessionId: string,
    title: string,
  ) => {
    await chatSessionsRepository.update(appId, sessionId, { title });

    set((state) => ({
      sessions: {
        ...state.sessions,
        [appId]: state.sessions[appId].map((s) =>
          s.id === sessionId ? { ...s, title } : s,
        ),
      },
    }));
  },

  updateMessageMetadata: async (
    appId: AppId,
    messageId: string,
    metadataUpdates: Partial<KairaChatMessage["metadata"]>,
  ) => {
    // Find the message to get current metadata
    const currentMessage = get().messages.find((m) => m.id === messageId);
    if (!currentMessage) {
      throw new Error(`Message ${messageId} not found`);
    }

    const updatedMetadata = {
      ...currentMessage.metadata,
      ...metadataUpdates,
    };

    // Update in database
    await chatMessagesRepository.update(appId, messageId, {
      metadata: updatedMetadata,
    });

    // Update in store
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, metadata: updatedMetadata } : m,
      ),
    }));
  },

  reset: () => set({
    currentSessionId: null,
    sessions: createSessionsByApp(),
    messages: [],
    isStreaming: false,
    streamingContent: "",
    error: null,
    isLoadingSessions: false,
    isLoadingMessages: false,
    isCreatingSession: false,
    isSending: false,
    isDeleting: false,
    isSessionsLoaded: createSessionsLoadedState(),
    abortController: null,
  }),
}));
