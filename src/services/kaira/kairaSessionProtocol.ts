/**
 * Kaira Session Protocol
 *
 * Shared protocol utilities for managing Kaira API session state across
 * SSE stream chunks. Mirrors the backend KairaSessionState dataclass
 * in backend/app/services/evaluators/models.py.
 */

import type { KairaStreamChunk, FoodCard } from '@/types';
import type { StreamMessageParams } from '@/services/kaira/kairaChatService';

// ─── Session State ───────────────────────────────────────────────

export interface KairaSessionState {
  userId: string;
  sessionId?: string;
  newSession: boolean;
  /** Sentinel buffer — tracks partial ___FOOD_CARD___...___END___ tokens */
  _sentinelBuffer: string;
  _inSentinel: boolean;
}

export function createSessionState(userId: string): KairaSessionState {
  return { userId, newSession: true, _sentinelBuffer: '', _inSentinel: false };
}

// ─── Request Builder ─────────────────────────────────────────────

/**
 * Build the correct StreamMessageParams for first vs subsequent messages.
 */
export function buildStreamRequest(
  state: KairaSessionState,
  message: string,
): StreamMessageParams {
  if (state.newSession) {
    return { message, user_id: state.userId, new_session: true };
  }
  if (!state.sessionId) {
    throw new Error('sessionId required for subsequent messages');
  }
  return {
    message,
    user_id: state.userId,
    new_session: false,
    session_id: state.sessionId,
  };
}

// ─── Sentinel Handling ───────────────────────────────────────────

const SENTINEL_START = '___FOOD_CARD___';
const SENTINEL_END = '___END___';

function longestSuffixMatchingPrefix(value: string, marker: string): number {
  const maxLength = Math.min(value.length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (marker.startsWith(value.slice(-length))) {
      return length;
    }
  }
  return 0;
}

/**
 * Strip ___FOOD_CARD___{json}___END___ sentinels that stream char-by-char
 * inside token chunks. Returns visible text only.
 * Mutates state._sentinelBuffer and state._inSentinel.
 */
export function stripSentinels(content: string, state: KairaSessionState): string {
  let visible = '';
  let remaining = state._sentinelBuffer + content;
  state._sentinelBuffer = '';

  while (remaining.length > 0) {
    if (!state._inSentinel) {
      const startIdx = remaining.indexOf(SENTINEL_START);
      if (startIdx === -1) {
        const pendingLength = longestSuffixMatchingPrefix(remaining, SENTINEL_START);
        if (pendingLength > 0) {
          visible += remaining.slice(0, -pendingLength);
          state._sentinelBuffer = remaining.slice(-pendingLength);
        } else {
          visible += remaining;
        }
        remaining = '';
      } else {
        visible += remaining.slice(0, startIdx);
        state._inSentinel = true;
        state._sentinelBuffer = '';
        remaining = remaining.slice(startIdx + SENTINEL_START.length);
      }
    } else {
      const endIdx = remaining.indexOf(SENTINEL_END);
      if (endIdx === -1) {
        state._sentinelBuffer += remaining;
        remaining = '';
      } else {
        // Discard buffered sentinel content; capture text after ___END___
        state._sentinelBuffer = '';
        state._inSentinel = false;
        remaining = remaining.slice(endIdx + SENTINEL_END.length);
      }
    }
  }

  return visible;
}

// ─── Chunk Processing ────────────────────────────────────────────

/** Session-identifier updates extracted from a chunk. */
export interface SessionUpdate {
  sessionId?: string;
  markFirstMessageDone?: boolean;
}

/** Content extracted from a chunk. */
export interface ChunkContent {
  /** Streaming text fragment (token) or clean final answer (done) */
  message?: string;
  /** True when the done chunk has been received — stream is complete */
  streamComplete?: boolean;
  /** Classification metadata */
  classification?: { intent: string; agent: string; confidence: number; source: 'text' | 'vision' };
  /** Structured food card (food_card chunk) */
  foodCard?: FoodCard;
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
 * Sentinel stripping DOES mutate state._sentinelBuffer / state._inSentinel (by design).
 */
export function processChunk(
  chunk: KairaStreamChunk,
  state: KairaSessionState,
): ChunkProcessingResult {
  const content: ChunkContent = {};
  let sessionUpdate: SessionUpdate | null = null;

  switch (chunk.type) {
    case 'classification':
      sessionUpdate = { sessionId: chunk.session_id, markFirstMessageDone: true };
      content.classification = {
        intent: chunk.intent,
        agent: chunk.agent,
        confidence: chunk.confidence,
        source: chunk.source,
      };
      break;

    case 'token': {
      const visible = stripSentinels(chunk.content, state);
      if (visible) {
        content.message = visible;
      }
      break;
    }

    case 'done':
      // full_response is already sentinel-free; overwrite accumulated streaming content
      content.message = chunk.full_response;
      content.streamComplete = true;
      break;

    case 'food_card':
      content.foodCard = chunk.data;
      break;

    case 'error':
      content.error = chunk.detail;
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
    ...(update.sessionId !== undefined && { sessionId: update.sessionId }),
    ...(update.markFirstMessageDone && { newSession: false }),
  };
}
