/**
 * Sherlock Part stream store — the ONLY Zustand store touching the Part stream.
 *
 * Holds the live, ephemeral, push-driven Part buffer per session. Server-shaped
 * reads (snapshot hydration, admin list/detail) live in TanStack Query, NOT here.
 * Hydration handoff: TQ snapshot -> seed(); SSE pushes -> applyEvent(); on seq
 * gap or stream error, the SSE layer asks TQ to invalidate, which re-seeds.
 *
 * Idempotent by design: replaying the same event must be a no-op. That lets us
 * reconcile snapshot + late events without bookkeeping.
 */
import { create } from 'zustand';

import type { SherlockPart } from '@/features/sherlock/generated/sherlockContract';

export type StreamStatus = 'idle' | 'streaming' | 'error';

export interface StreamEvent {
  kind: 'part_added' | 'part_updated';
  seq: number;
  part: SherlockPart;
}

interface StreamState {
  partsBySession: Record<string, SherlockPart[]>;
  lastSeqBySession: Record<string, number>;
  hasGapBySession: Record<string, boolean>;
  status: StreamStatus;

  seed(sessionId: string, parts: SherlockPart[], lastSeq: number): void;
  applyEvent(sessionId: string, event: StreamEvent): void;
  setStatus(status: StreamStatus): void;
  reset(sessionId: string): void;
}

export const useStreamStore = create<StreamState>((set) => ({
  partsBySession: {},
  lastSeqBySession: {},
  hasGapBySession: {},
  status: 'idle',

  seed(sessionId, parts, lastSeq) {
    set((state) => ({
      partsBySession: { ...state.partsBySession, [sessionId]: parts },
      lastSeqBySession: { ...state.lastSeqBySession, [sessionId]: lastSeq },
      hasGapBySession: { ...state.hasGapBySession, [sessionId]: false },
    }));
  },

  applyEvent(sessionId, event) {
    set((state) => {
      const existing = state.partsBySession[sessionId] ?? [];
      const lastSeq = state.lastSeqBySession[sessionId] ?? -1;
      const expected = lastSeq + 1;
      // A gap means the snapshot we're holding is behind the server. Flag it;
      // the SSE layer reads the flag, asks TQ to invalidate, and the next
      // seed() clears it. We still apply the current event so the buffer
      // stays as fresh as possible while we wait for the refetch.
      const gap = event.seq > expected && lastSeq >= 0;
      const nextParts = upsertPart(existing, event);
      return {
        partsBySession: { ...state.partsBySession, [sessionId]: nextParts },
        lastSeqBySession: {
          ...state.lastSeqBySession,
          [sessionId]: Math.max(lastSeq, event.seq),
        },
        hasGapBySession: { ...state.hasGapBySession, [sessionId]: gap },
      };
    });
  },

  setStatus(status) {
    set({ status });
  },

  reset(sessionId) {
    set((state) => {
      const partsBySession = { ...state.partsBySession };
      const lastSeqBySession = { ...state.lastSeqBySession };
      const hasGapBySession = { ...state.hasGapBySession };
      delete partsBySession[sessionId];
      delete lastSeqBySession[sessionId];
      delete hasGapBySession[sessionId];
      return { partsBySession, lastSeqBySession, hasGapBySession };
    });
  },
}));

function upsertPart(parts: SherlockPart[], event: StreamEvent): SherlockPart[] {
  const index = parts.findIndex((p) => p.id === event.part.id);
  if (event.kind === 'part_added') {
    if (index >= 0) {
      // Duplicate add (replay) — replace in place to honour the latest payload.
      const next = parts.slice();
      next[index] = event.part;
      return next;
    }
    return [...parts, event.part];
  }
  // part_updated
  if (index < 0) {
    // Late update for a Part we never saw added — accept it; the next snapshot
    // will reconcile.
    return [...parts, event.part];
  }
  const next = parts.slice();
  next[index] = event.part;
  return next;
}

export const selectSessionParts = (sessionId: string) =>
  (state: StreamState): SherlockPart[] =>
    state.partsBySession[sessionId] ?? [];

export const selectSessionHasGap = (sessionId: string) =>
  (state: StreamState): boolean => state.hasGapBySession[sessionId] ?? false;

export const selectSessionLastSeq = (sessionId: string) =>
  (state: StreamState): number => state.lastSeqBySession[sessionId] ?? -1;
