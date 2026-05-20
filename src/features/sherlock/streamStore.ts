/** Live Part buffer per session. Server-shaped reads go through TanStack Query, not here. */
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
  resetAll(): void;
}

export const useStreamStore = create<StreamState>((set) => ({
  partsBySession: {},
  lastSeqBySession: {},
  hasGapBySession: {},
  status: 'idle',

  seed(sessionId, parts, lastSeq) {
    set((state) => {
      const existing = state.partsBySession[sessionId] ?? [];
      const liveLast = state.lastSeqBySession[sessionId] ?? -1;
      // Preserve any live SSE parts past the snapshot's last seq so a hydration
      // refetch never blows away frames that arrived after the snapshot was cut.
      const survivors =
        liveLast > lastSeq
          ? existing.filter((p) => {
              const seq = (p as { seq?: number }).seq;
              return typeof seq === 'number' && seq > lastSeq;
            })
          : [];
      const merged = mergeParts(parts, survivors);
      return {
        partsBySession: { ...state.partsBySession, [sessionId]: merged },
        lastSeqBySession: {
          ...state.lastSeqBySession,
          [sessionId]: Math.max(lastSeq, liveLast),
        },
        hasGapBySession: { ...state.hasGapBySession, [sessionId]: false },
      };
    });
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

  resetAll() {
    set({ partsBySession: {}, lastSeqBySession: {}, hasGapBySession: {}, status: 'idle' });
  },
}));

function mergeParts(snapshot: SherlockPart[], survivors: SherlockPart[]): SherlockPart[] {
  if (survivors.length === 0) return snapshot;
  const byId = new Map<string, SherlockPart>();
  for (const p of snapshot) byId.set(p.id, p);
  for (const p of survivors) byId.set(p.id, p);
  return Array.from(byId.values()).sort((a, b) => {
    const sa = (a as { seq?: number }).seq ?? 0;
    const sb = (b as { seq?: number }).seq ?? 0;
    return sa - sb;
  });
}

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

// Stable empty reference so selectors don't return a fresh [] each render
// (a new ref would make Zustand re-render forever — "max update depth").
const EMPTY_PARTS: readonly SherlockPart[] = Object.freeze([]);

export const selectSessionParts = (sessionId: string) =>
  (state: StreamState): SherlockPart[] =>
    (state.partsBySession[sessionId] ?? EMPTY_PARTS) as SherlockPart[];

export const selectSessionHasGap = (sessionId: string) =>
  (state: StreamState): boolean => state.hasGapBySession[sessionId] ?? false;

export const selectSessionLastSeq = (sessionId: string) =>
  (state: StreamState): number => state.lastSeqBySession[sessionId] ?? -1;
