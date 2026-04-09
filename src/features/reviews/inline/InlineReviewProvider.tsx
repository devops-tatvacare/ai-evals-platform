import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  EvalReviewDetail,
  ReviewableAttribute,
  ReviewableItem,
  ReviewItemUpsert,
  ReviewDraftUpdate,
  RunReviewContext,
} from '@/types';
import {
  fetchRunReviewContext,
  createRunReviewDraft,
  fetchReviewDetail,
  saveReviewDraft,
  finalizeReview,
  discardReviewDraft,
} from '@/services/api/reviewsApi';
import { notificationService } from '@/services/notifications';
import type { InlineEditState, InlineReviewContextValue } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reviewKey(itemKey: string, attributeKey: string): string {
  return `${itemKey}::${attributeKey}`;
}

function buildEditsFromReview(review: EvalReviewDetail): Record<string, InlineEditState> {
  const map: Record<string, InlineEditState> = {};
  for (const item of review.items) {
    const key = reviewKey(item.itemKey, item.attributeKey);
    map[key] = {
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: item.attributeKey,
      decision: item.decision,
      originalValue: item.originalValue,
      reviewedValue: item.reviewedValue,
      reasonCode: item.reasonCode,
      note: item.note,
    };
  }
  return map;
}

function toPayload(notes: string, edits: Record<string, InlineEditState>): ReviewDraftUpdate {
  const items: ReviewItemUpsert[] = Object.values(edits)
    .filter(
      (e): e is InlineEditState & { decision: 'accept' | 'reject' | 'correct' } =>
        e.decision !== '',
    )
    .map((e) => ({
      itemKey: e.itemKey,
      itemType: e.itemType,
      attributeKey: e.attributeKey,
      decision: e.decision,
      originalValue: e.originalValue,
      reviewedValue: e.decision === 'correct' ? e.reviewedValue : null,
      reasonCode: e.reasonCode,
      note: e.note,
    }));
  return { notes, items };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const InlineReviewContext = createContext<InlineReviewContextValue | null>(null);

export function useInlineReview(): InlineReviewContextValue {
  const value = useContext(InlineReviewContext);
  if (!value) {
    throw new Error('useInlineReview must be used within an InlineReviewProvider');
  }
  return value;
}

export function useInlineReviewOptional(): InlineReviewContextValue | null {
  return useContext(InlineReviewContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface InlineReviewProviderProps {
  runId: string;
  appId: string;
  enabled: boolean;
  children: ReactNode;
}

export function InlineReviewProvider({ runId, enabled, children }: InlineReviewProviderProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState<RunReviewContext | null>(null);
  const [selectedReview, setSelectedReview] = useState<EvalReviewDetail | null>(null);
  const [edits, setEdits] = useState<Record<string, InlineEditState>>({});

  // Guard against stale async completions after unmount or runId change
  const activeRunId = useRef(runId);
  activeRunId.current = runId;

  // ------ Load context on mount / when enabled ------

  const loadContext = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await fetchRunReviewContext(runId);
      if (activeRunId.current !== runId) return;
      setContext(ctx);

      const existingId = ctx.draftReviewId ?? ctx.latestReviewId;
      if (existingId) {
        const detail = await fetchReviewDetail(existingId);
        if (activeRunId.current !== runId) return;
        setSelectedReview(detail);
        setEdits(buildEditsFromReview(detail));
      } else {
        setSelectedReview(null);
        setEdits({});
      }
    } catch (err) {
      notificationService.error('Failed to load review context');
      console.error(err);
    } finally {
      if (activeRunId.current === runId) {
        setLoading(false);
      }
    }
  }, [runId]);

  useEffect(() => {
    if (enabled) {
      loadContext();
    }
  }, [enabled, loadContext]);

  // ------ Derived state ------

  const isEditing = selectedReview?.status === 'draft';

  const { dirtyCount, dirtySummary } = useMemo(() => {
    const dirty = Object.values(edits).filter((e) => e.decision !== '');
    const count = dirty.length;
    const summary = dirty
      .slice(0, 3)
      .map((e) => `${e.attributeKey}: ${e.decision}`)
      .join(', ');
    return { dirtyCount: count, dirtySummary: summary };
  }, [edits]);

  // ------ Actions ------

  const getEdit = useCallback(
    (itemKey: string, attributeKey: string): InlineEditState | undefined => {
      return edits[reviewKey(itemKey, attributeKey)];
    },
    [edits],
  );

  const updateAttribute = useCallback(
    (item: ReviewableItem, attribute: ReviewableAttribute, patch: Partial<InlineEditState>) => {
      const key = reviewKey(item.itemKey, attribute.key);
      const defaults: InlineEditState = {
        itemKey: item.itemKey,
        itemType: item.itemType,
        attributeKey: attribute.key,
        decision: '',
        originalValue: attribute.originalValue,
        reviewedValue: null,
        reasonCode: null,
        note: null,
      };
      setEdits((prev) => ({
        ...prev,
        [key]: { ...defaults, ...prev[key], ...patch },
      }));
    },
    [],
  );

  const acceptAttribute = useCallback(
    (item: ReviewableItem, attribute: ReviewableAttribute) => {
      updateAttribute(item, attribute, { decision: 'accept' });
    },
    [updateAttribute],
  );

  const startDraft = useCallback(async () => {
    setSaving(true);
    try {
      const detail = await createRunReviewDraft(runId);
      setSelectedReview(detail);
      setEdits(buildEditsFromReview(detail));
      notificationService.success('Review draft created');
    } catch (err) {
      notificationService.error('Failed to create review draft');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [runId]);

  const handleSaveDraft = useCallback(async () => {
    if (!selectedReview) return;
    setSaving(true);
    try {
      const payload = toPayload(selectedReview.notes ?? '', edits);
      const updated = await saveReviewDraft(selectedReview.id, payload);
      setSelectedReview(updated);
      setEdits(buildEditsFromReview(updated));
      notificationService.success('Draft saved');
    } catch (err) {
      notificationService.error('Failed to save draft');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [selectedReview, edits]);

  const handleFinalize = useCallback(async () => {
    if (!selectedReview) return;
    setSaving(true);
    try {
      const payload = toPayload(selectedReview.notes ?? '', edits);
      const updated = await finalizeReview(selectedReview.id, payload);
      setSelectedReview(updated);
      setEdits(buildEditsFromReview(updated));
      notificationService.success('Review finalized');
    } catch (err) {
      notificationService.error('Failed to finalize review');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [selectedReview, edits]);

  const handleDiscard = useCallback(async () => {
    if (!selectedReview) return;
    setSaving(true);
    try {
      await discardReviewDraft(selectedReview.id);
      setSelectedReview(null);
      setEdits({});
      notificationService.success('Draft discarded');
      // Reload context to pick up updated history
      await loadContext();
    } catch (err) {
      notificationService.error('Failed to discard draft');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }, [selectedReview, loadContext]);

  // ------ Context value ------

  const value = useMemo<InlineReviewContextValue>(
    () => ({
      isEditing,
      loading,
      saving,
      context,
      selectedReview,
      edits,
      dirtyCount,
      dirtySummary,
      startDraft,
      getEdit,
      updateAttribute,
      acceptAttribute,
      saveDraft: handleSaveDraft,
      finalize: handleFinalize,
      discardDraft: handleDiscard,
    }),
    [
      isEditing,
      loading,
      saving,
      context,
      selectedReview,
      edits,
      dirtyCount,
      dirtySummary,
      startDraft,
      getEdit,
      updateAttribute,
      acceptAttribute,
      handleSaveDraft,
      handleFinalize,
      handleDiscard,
    ],
  );

  return (
    <InlineReviewContext.Provider value={value}>
      {children}
    </InlineReviewContext.Provider>
  );
}
