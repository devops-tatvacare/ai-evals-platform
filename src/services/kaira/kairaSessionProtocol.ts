/**
 * Kaira Session Protocol
 *
 * Shared protocol utilities for managing Kaira API session state across
 * SSE stream chunks. Mirrors the backend KairaSessionState dataclass
 * in backend/app/services/evaluators/models.py.
 */

import type { KairaStreamChunk, FoodCard } from '@/types';
import type { StreamMessageParams } from '@/services/kaira/kairaChatService';
import { allSentinelMarkers } from '@/services/kaira/widgetGrammar';

// ─── Session State ───────────────────────────────────────────────

export interface KairaSessionState {
  userId: string;
  sessionId?: string;
  newSession: boolean;
  /** Sentinel buffer — tracks partial ___MARKER___...___END[_*]___ tokens */
  _sentinelBuffer: string;
  _inSentinel: boolean;
  /** When inside a sentinel, which close marker we're waiting for */
  _expectedClose: string | null;
}

export function createSessionState(userId: string): KairaSessionState {
  return {
    userId,
    newSession: true,
    _sentinelBuffer: '',
    _inSentinel: false,
    _expectedClose: null,
  };
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
//
// Token-stream sentinels come in pairs (open, close). The kaira-ai backend
// embeds them as in-band markers around structured payloads
// (___FOOD_CARD___, ___BP_CARD___, ___VITALS_CARD___, ___MULTI_FOOD_CARD___,
// ___SESSION_STATE___). The set is owned by widgetGrammar.ts; this stripper
// consumes whatever the registry exposes via allSentinelMarkers().

const SENTINEL_PAIRS: ReadonlyArray<{ open: string; close: string }> =
  allSentinelMarkers().map(({ open, close }) => ({ open, close }));

function longestSuffixMatchingPrefix(value: string, marker: string): number {
  const maxLength = Math.min(value.length, marker.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (marker.startsWith(value.slice(-length))) {
      return length;
    }
  }
  return 0;
}

/** Find the earliest opening marker in `value`. Returns idx + matched marker. */
function findEarliestOpen(value: string): { index: number; marker: { open: string; close: string } } | null {
  let best: { index: number; marker: { open: string; close: string } } | null = null;
  for (const pair of SENTINEL_PAIRS) {
    const idx = value.indexOf(pair.open);
    if (idx === -1) continue;
    if (best === null || idx < best.index) {
      best = { index: idx, marker: pair };
    }
  }
  return best;
}

/** Longest pending suffix across all known opening markers. */
function longestPendingOpenSuffix(value: string): number {
  let best = 0;
  for (const pair of SENTINEL_PAIRS) {
    const len = longestSuffixMatchingPrefix(value, pair.open);
    if (len > best) best = len;
  }
  return best;
}

/**
 * Strip every registered ___MARKER___{json}___END[_*]___ pair from a
 * token-stream chunk. Returns visible text only.
 * Mutates state._sentinelBuffer, state._inSentinel, state._expectedClose.
 */
export function stripSentinels(content: string, state: KairaSessionState): string {
  let visible = '';
  let remaining = state._sentinelBuffer + content;
  state._sentinelBuffer = '';

  while (remaining.length > 0) {
    if (!state._inSentinel) {
      const hit = findEarliestOpen(remaining);
      if (hit === null) {
        const pendingLength = longestPendingOpenSuffix(remaining);
        if (pendingLength > 0) {
          visible += remaining.slice(0, -pendingLength);
          state._sentinelBuffer = remaining.slice(-pendingLength);
        } else {
          visible += remaining;
        }
        remaining = '';
      } else {
        visible += remaining.slice(0, hit.index);
        state._inSentinel = true;
        state._expectedClose = hit.marker.close;
        state._sentinelBuffer = '';
        remaining = remaining.slice(hit.index + hit.marker.open.length);
      }
    } else {
      const close = state._expectedClose ?? '___END___';
      const endIdx = remaining.indexOf(close);
      if (endIdx === -1) {
        // Buffer through; we may need to wait for more tokens
        state._sentinelBuffer += remaining;
        remaining = '';
      } else {
        state._sentinelBuffer = '';
        state._inSentinel = false;
        state._expectedClose = null;
        remaining = remaining.slice(endIdx + close.length);
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
  /** Structured food card (food_card chunk). May be single or batch shape. */
  foodCard?: FoodCard | { isBatch: true; sessions: FoodCard[] };
  /** BP card payload (bp_card chunk) */
  bpCard?: Record<string, unknown>;
  /** Vitals card payload (vitals_card chunk) */
  vitalsCard?: Record<string, unknown>;
  /** Error from error chunk */
  error?: string;
  /**
   * Forward-compat: chunk kind not modelled by the FE yet. UI renders an
   * UnsupportedWidgetPlaceholder so engineers see the gap.
   */
  unknownWidget?: { kind: string; data: Record<string, unknown> };
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

    case 'bp_card':
      content.bpCard = chunk.data;
      break;

    case 'vitals_card':
      content.vitalsCard = chunk.data;
      break;

    case 'error':
      content.error = chunk.detail;
      break;

    default: {
      // Forward-compat: unknown chunk kind. Surface for forensics/grading.
      const unk = chunk as { type: string; data?: unknown; [k: string]: unknown };
      content.unknownWidget = {
        kind: unk.type ?? 'unknown',
        data: (unk.data as Record<string, unknown>) ?? unk,
      };
      break;
    }
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
