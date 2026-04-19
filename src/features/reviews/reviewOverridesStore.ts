import { useEffect } from 'react';
import { create } from 'zustand';
import type { ActiveDraftInfo, EvalReviewSummary, ReviewItemRecord } from '@/types/reviews';
import { fetchRunReviewContext, fetchReviewDetail } from '@/services/api/reviewsApi';

/**
 * Shared cache of a run's review context per runId.
 *
 * One fetch per runId regardless of how many components mount. Mutations
 * (finalize / discard) must call `invalidate(runId)`; `reviewModeStore` does this.
 *
 * Stores items + activeDraft + history from the single /api/reviews/runs/{id}
 * call so Start-Review lock state and the History tab consume it without
 * another network round-trip.
 */

type EntryStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface Entry {
  status: EntryStatus;
  items: ReviewItemRecord[];
  activeDraft: ActiveDraftInfo | null;
  history: EvalReviewSummary[];
  promise: Promise<ReviewItemRecord[]> | null;
}

interface ReviewOverridesStoreState {
  entries: Record<string, Entry>;
  /**
   * Trigger a fetch for `runId` if one is not already in flight or cached.
   * Returns the items array once the fetch settles.
   */
  ensureLoaded: (runId: string) => Promise<ReviewItemRecord[]>;
  /** Drop the cache for `runId`. Next `ensureLoaded` will re-fetch. */
  invalidate: (runId: string) => void;
}

const EMPTY_ITEMS: ReviewItemRecord[] = [];
const EMPTY_HISTORY: EvalReviewSummary[] = [];

export const useReviewOverridesStore = create<ReviewOverridesStoreState>((set, get) => ({
  entries: {},

  ensureLoaded: (runId) => {
    const existing = get().entries[runId];
    if (existing?.status === 'loaded') {
      return Promise.resolve(existing.items);
    }
    if (existing?.promise) {
      return existing.promise;
    }

    const promise: Promise<ReviewItemRecord[]> = (async () => {
      try {
        const ctx = await fetchRunReviewContext(runId);
        const reviewId = ctx.latestReviewId ?? ctx.draftReviewId;
        let items: ReviewItemRecord[] = [];
        if (reviewId) {
          const detail = await fetchReviewDetail(reviewId);
          items = detail.items;
        }
        set((state) => ({
          entries: {
            ...state.entries,
            [runId]: {
              status: 'loaded',
              items,
              activeDraft: ctx.activeDraft,
              history: ctx.history,
              promise: null,
            },
          },
        }));
        return items;
      } catch {
        set((state) => ({
          entries: {
            ...state.entries,
            [runId]: {
              status: 'error',
              items: EMPTY_ITEMS,
              activeDraft: null,
              history: EMPTY_HISTORY,
              promise: null,
            },
          },
        }));
        return EMPTY_ITEMS;
      }
    })();

    set((state) => ({
      entries: {
        ...state.entries,
        [runId]: {
          status: 'loading',
          items: existing?.items ?? EMPTY_ITEMS,
          activeDraft: existing?.activeDraft ?? null,
          history: existing?.history ?? EMPTY_HISTORY,
          promise,
        },
      },
    }));

    return promise;
  },

  invalidate: (runId) => {
    set((state) => {
      if (!state.entries[runId]) return state;
      const next = { ...state.entries };
      delete next[runId];
      return { entries: next };
    });
  },
}));

/** Read-only selector for a run's persisted items (empty array if not loaded). */
export function selectPersistedItems(runId: string | undefined): ReviewItemRecord[] {
  if (!runId) return EMPTY_ITEMS;
  return useReviewOverridesStore.getState().entries[runId]?.items ?? EMPTY_ITEMS;
}

export interface RunReviewMeta {
  activeDraft: ActiveDraftInfo | null;
  history: EvalReviewSummary[];
  loaded: boolean;
}

/**
 * Subscribe to a run's cached review meta (active draft + history).
 *
 * Triggers a shared fetch via `ensureLoaded` — no extra network calls when
 * other hooks on the page already loaded the same runId.
 */
export function useRunReviewMeta(runId: string | undefined): RunReviewMeta {
  const entry = useReviewOverridesStore((s) => (runId ? s.entries[runId] : undefined));
  const ensureLoaded = useReviewOverridesStore((s) => s.ensureLoaded);

  useEffect(() => {
    if (!runId) return;
    ensureLoaded(runId);
  }, [runId, ensureLoaded]);

  return {
    activeDraft: entry?.activeDraft ?? null,
    history: entry?.history ?? EMPTY_HISTORY,
    loaded: entry?.status === 'loaded',
  };
}
