/**
 * Kaira Session Protocol
 *
 * Shared protocol utilities for managing Kaira API session state across
 * SSE stream chunks. Mirrors the backend KairaSessionState dataclass
 * in backend/app/services/evaluators/models.py.
 */

import type { KairaStreamChunk } from '@/types';
import type { StreamMessageParams } from '@/services/kaira/kairaChatService';

// ─── Session State ───────────────────────────────────────────────

export interface KairaSessionState {
  userId: string;
  threadId?: string;
  sessionId?: string;
  responseId?: string;
  isFirstMessage: boolean;
}

export function createSessionState(userId: string): KairaSessionState {
  return { userId, isFirstMessage: true };
}

// ─── Request Builder ─────────────────────────────────────────────

/**
 * Build the correct StreamMessageParams for first vs subsequent messages.
 */
export function buildStreamRequest(
  state: KairaSessionState,
  query: string,
): StreamMessageParams {
  if (state.isFirstMessage) {
    return {
      query,
      user_id: state.userId,
      session_id: state.userId, // Same as user_id for first message
      context: { additionalProp1: {} },
      stream: false,
      end_session: true,
    };
  }
  if (!state.sessionId || !state.threadId) {
    throw new Error('sessionId and threadId required for subsequent messages');
  }
  return {
    query,
    user_id: state.userId,
    session_id: state.sessionId,
    context: { additionalProp1: {} },
    stream: false,
    thread_id: state.threadId,
    end_session: false,
  };
}

// ─── Chunk Processing ────────────────────────────────────────────

/** Session-identifier updates extracted from a chunk. */
export interface SessionUpdate {
  threadId?: string;
  sessionId?: string;
  responseId?: string;
  markFirstMessageDone?: boolean;
}

/** Content extracted from a chunk (intents, agent responses, etc.). */
export interface ChunkContent {
  /** If the chunk carries displayable message text. */
  message?: string;
  /** intent_classification data */
  intents?: Array<{ agent: string; confidence: number }>;
  isMultiIntent?: boolean;
  /** agent_response data */
  agentResponse?: { agent: string; message: string; success: boolean; data?: unknown };
  /** response_id carried by agent_response */
  responseId?: string;
  /** Informational log (session_end / session_start) */
  logMessage?: string;
  /** Error from error chunk */
  error?: string;
}

export interface ChunkProcessingResult {
  sessionUpdate: SessionUpdate | null;
  content: ChunkContent;
}

/**
 * Pure function: extract session updates and content from a single SSE chunk.
 * Does NOT mutate state — caller applies updates via applySessionUpdate().
 */
export function processChunk(
  chunk: KairaStreamChunk,
  currentState: KairaSessionState,
): ChunkProcessingResult {
  const content: ChunkContent = {};
  let sessionUpdate: SessionUpdate | null = null;

  switch (chunk.type) {
    case 'stream_start':
      if (chunk.thread_id) {
        sessionUpdate = { threadId: chunk.thread_id };
      }
      break;

    case 'session_context':
      sessionUpdate = {
        threadId: chunk.thread_id,
        sessionId: chunk.session_id,
        responseId: chunk.response_id,
        ...(currentState.isFirstMessage ? { markFirstMessageDone: true } : {}),
      };
      content.responseId = chunk.response_id;
      break;

    case 'intent_classification':
      content.intents = chunk.detected_intents;
      content.isMultiIntent = chunk.is_multi_intent;
      break;

    case 'agent_response': {
      content.agentResponse = {
        agent: chunk.agent,
        message: chunk.message,
        success: chunk.success,
        data: chunk.data,
      };
      if (chunk.response_id) {
        content.responseId = chunk.response_id;
      }
      if (chunk.success && chunk.message) {
        content.message = chunk.message;
      }
      // Sync thread_id / response_id if present
      if (chunk.thread_id || chunk.response_id) {
        sessionUpdate = {};
        if (chunk.thread_id && chunk.thread_id !== currentState.threadId) {
          sessionUpdate.threadId = chunk.thread_id;
        }
        if (chunk.response_id) {
          sessionUpdate.responseId = chunk.response_id;
        }
        // If nothing actually changed, drop the update
        if (!sessionUpdate.threadId && !sessionUpdate.responseId) {
          sessionUpdate = null;
        }
      }
      break;
    }

    case 'summary':
      content.message = chunk.message;
      break;

    case 'session_end':
      content.logMessage = `Session ended: ${chunk.message}`;
      // Sync thread_id if present (matches backend apply_chunk behavior)
      if (chunk.thread_id && chunk.thread_id !== currentState.threadId) {
        sessionUpdate = { threadId: chunk.thread_id };
      }
      break;

    case 'session_start':
      content.logMessage = `Agent session started: ${chunk.agent}`;
      if (chunk.thread_id && chunk.thread_id !== currentState.threadId) {
        sessionUpdate = { threadId: chunk.thread_id };
      }
      break;

    case 'error':
      content.error = chunk.error;
      break;
  }

  return { sessionUpdate, content };
}

// ─── State Updater ───────────────────────────────────────────────

/**
 * Immutable state updater — returns a new KairaSessionState with
 * the session update applied.
 */
export function applySessionUpdate(
  state: KairaSessionState,
  update: SessionUpdate,
): KairaSessionState {
  return {
    ...state,
    ...(update.threadId !== undefined && { threadId: update.threadId }),
    ...(update.sessionId !== undefined && { sessionId: update.sessionId }),
    ...(update.responseId !== undefined && { responseId: update.responseId }),
    ...(update.markFirstMessageDone && { isFirstMessage: false }),
  };
}
