import { create } from 'zustand';
import type { AppId } from '@/types';
import type {
  RunReviewContext,
  EvalReviewDetail,
  ReviewableItem,
  ReviewableAttribute,
  ReviewItemUpsert,
} from '@/types/reviews';
import type { InlineEditState } from '@/features/reviews/inline/types';
import {
  fetchRunReviewContext,
  createRunReviewDraft,
  saveReviewDraft,
  finalizeReview,
  discardReviewDraft,
} from '@/services/api/reviewsApi';
import { notificationService } from '@/services/notifications';

// ---------------------------------------------------------------------------
// Helpers (lifted from InlineReviewProvider — shared logic)
// ---------------------------------------------------------------------------

function reviewKey(itemKey: string, attributeKey: string): string {
  return `${itemKey}::${attributeKey}`;
}

function reviewKeyCandidates(itemKey: string, attributeKey: string): string[] {
  const exact = reviewKey(itemKey, attributeKey);
  const rawItemKey = itemKey.includes(':') ? itemKey.split(':').slice(1).join(':') : itemKey;
  const candidates = new Set<string>([
    exact,
    reviewKey(rawItemKey, attributeKey),
    reviewKey(`thread:${rawItemKey}`, attributeKey),
    reviewKey(`call:${rawItemKey}`, attributeKey),
    reviewKey(`segment:${rawItemKey}`, attributeKey),
    reviewKey(`field:${rawItemKey}`, attributeKey),
  ]);
  return Array.from(candidates);
}

function findStoredKey(
  map: Record<string, InlineEditState>,
  itemKey: string,
  attributeKey: string,
): string | null {
  for (const candidate of reviewKeyCandidates(itemKey, attributeKey)) {
    if (map[candidate]) return candidate;
  }
  return null;
}

function normalizeValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEdit(edit: InlineEditState): InlineEditState {
  return {
    ...edit,
    originalValue: normalizeValue(edit.originalValue),
    reviewedValue: edit.decision === 'correct' ? normalizeValue(edit.reviewedValue) : null,
    reasonCode: normalizeValue(edit.reasonCode),
    note: normalizeValue(edit.note),
  };
}

function areEditsEqual(a: InlineEditState | undefined, b: InlineEditState | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const left = normalizeEdit(a);
  const right = normalizeEdit(b);
  return (
    left.itemKey === right.itemKey &&
    left.itemType === right.itemType &&
    left.attributeKey === right.attributeKey &&
    left.decision === right.decision &&
    left.originalValue === right.originalValue &&
    left.reviewedValue === right.reviewedValue &&
    left.reasonCode === right.reasonCode &&
    left.note === right.note
  );
}

function cleanupEdit(
  current: InlineEditState,
  baseline: InlineEditState | undefined,
): InlineEditState | null {
  const normalized = normalizeEdit(current);
  const isEmpty =
    normalized.decision === '' &&
    normalized.reviewedValue == null &&
    normalized.reasonCode == null &&
    normalized.note == null;
  if (isEmpty && !baseline) return null;
  return normalized;
}

function buildEditsFromReview(review: EvalReviewDetail): Record<string, InlineEditState> {
  const map: Record<string, InlineEditState> = {};
  for (const item of review.items) {
    const key = reviewKey(item.itemKey, item.attributeKey);
    map[key] = normalizeEdit({
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: item.attributeKey,
      decision: item.decision,
      originalValue: item.originalValue,
      reviewedValue: item.reviewedValue,
      reasonCode: item.reasonCode,
      note: item.note,
    });
  }
  return map;
}

function toPayload(notes: string, edits: Record<string, InlineEditState>) {
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

function computeDirty(
  edits: Record<string, InlineEditState>,
  baselineEdits: Record<string, InlineEditState>,
): { dirtyCount: number; dirtySummary: string } {
  const allKeys = new Set([...Object.keys(edits), ...Object.keys(baselineEdits)]);
  const dirtyKeys: string[] = [];
  for (const key of allKeys) {
    if (!areEditsEqual(edits[key], baselineEdits[key])) {
      dirtyKeys.push(key);
    }
  }
  const summaryParts = dirtyKeys.slice(0, 3).map((key) => {
    const edit = edits[key];
    if (!edit) return null;
    const label = edit.attributeKey || key;
    if (edit.decision === 'accept' && edit.note) return `${label} note`;
    if (edit.decision === 'accept') return `${label} accepted`;
    if (edit.decision === 'correct') return `${label} → ${edit.reviewedValue}`;
    if (edit.decision === 'reject') return `${label} rejected`;
    return label;
  }).filter(Boolean);
  return {
    dirtyCount: dirtyKeys.length,
    dirtySummary: summaryParts.join(', ') + (dirtyKeys.length > 3 ? ` +${dirtyKeys.length - 3} more` : ''),
  };
}

// ---------------------------------------------------------------------------
// Store types
// ---------------------------------------------------------------------------

export type ReviewModeStatus = 'idle' | 'entering' | 'reviewing' | 'saving' | 'finalizing' | 'exiting';

interface ReviewModeState {
  active: boolean;
  runId: string | null;
  appId: AppId | null;
  reviewId: string | null;
  status: ReviewModeStatus;
  context: RunReviewContext | null;
  edits: Record<string, InlineEditState>;
  baselineEdits: Record<string, InlineEditState>;
  notes: string;

  enterReview: (runId: string, appId: AppId) => Promise<void>;
  updateAttribute: (itemKey: string, attrKey: string, patch: Partial<InlineEditState>) => void;
  acceptAttribute: (item: ReviewableItem, attr: ReviewableAttribute) => void;
  correctAttribute: (item: ReviewableItem, attr: ReviewableAttribute, reviewedValue: string) => void;
  clearAttribute: (item: ReviewableItem, attr: ReviewableAttribute) => void;
  setAttributeNote: (item: ReviewableItem, attr: ReviewableAttribute, note: string | null) => void;
  saveDraft: () => Promise<void>;
  finalize: () => Promise<void>;
  discardDraft: () => Promise<void>;
  exitReview: () => void;

  getEdit: (itemKey: string, attrKey: string) => InlineEditState | undefined;
  isAttributeSaved: (itemKey: string, attrKey: string) => boolean;
  getDirty: () => { dirtyCount: number; dirtySummary: string; isDirty: boolean };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const INITIAL_STATE = {
  active: false,
  runId: null as string | null,
  appId: null as AppId | null,
  reviewId: null as string | null,
  status: 'idle' as ReviewModeStatus,
  context: null as RunReviewContext | null,
  edits: {} as Record<string, InlineEditState>,
  baselineEdits: {} as Record<string, InlineEditState>,
  notes: '',
};

export const useReviewModeStore = create<ReviewModeState>()((set, get) => ({
  ...INITIAL_STATE,

  enterReview: async (runId, appId) => {
    set({ status: 'entering', runId, appId });

    // Close Sherlock if open
    try {
      const { useChatWidgetStore } = await import('@/features/chat-widget/useChatWidget');
      const chatState = useChatWidgetStore.getState();
      if (chatState.open) chatState.toggle();
    } catch { /* chat widget may not exist */ }

    try {
      const ctx = await fetchRunReviewContext(runId);
      const draft = await createRunReviewDraft(runId);
      const edits = buildEditsFromReview(draft);
      const baselineEdits = { ...edits };
      set({
        active: true,
        status: 'reviewing',
        reviewId: draft.id,
        context: ctx,
        edits,
        baselineEdits,
        notes: draft.notes ?? '',
      });
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Failed to start review');
      set(INITIAL_STATE);
    }
  },

  updateAttribute: (itemKey, attrKey, patch) => {
    const { edits, baselineEdits } = get();
    const storedKey = findStoredKey(edits, itemKey, attrKey) ?? findStoredKey(baselineEdits, itemKey, attrKey) ?? reviewKey(itemKey, attrKey);
    const current = edits[storedKey] ?? {
      itemKey, itemType: '', attributeKey: attrKey,
      decision: '' as const, originalValue: null, reviewedValue: null,
      reasonCode: null, note: null,
    };
    const updated = { ...current, ...patch };
    const cleaned = cleanupEdit(updated, baselineEdits[storedKey]);
    if (cleaned) {
      set({ edits: { ...edits, [storedKey]: cleaned } });
    } else {
      const next = { ...edits };
      delete next[storedKey];
      set({ edits: next });
    }
  },

  acceptAttribute: (item, attr) => {
    get().updateAttribute(item.itemKey, attr.key, {
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: attr.key,
      decision: 'accept',
      originalValue: attr.originalValue,
    });
  },

  correctAttribute: (item, attr, reviewedValue) => {
    get().updateAttribute(item.itemKey, attr.key, {
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: attr.key,
      decision: 'correct',
      originalValue: attr.originalValue,
      reviewedValue,
    });
  },

  clearAttribute: (item, attr) => {
    const { edits, baselineEdits } = get();
    const storedKey = findStoredKey(edits, item.itemKey, attr.key) ?? reviewKey(item.itemKey, attr.key);
    const baseline = baselineEdits[storedKey];
    if (baseline) {
      // Reset to baseline
      set({ edits: { ...edits, [storedKey]: { ...baseline } } });
    } else {
      const next = { ...edits };
      delete next[storedKey];
      set({ edits: next });
    }
  },

  setAttributeNote: (item, attr, note) => {
    const { edits, baselineEdits } = get();
    const storedKey = findStoredKey(edits, item.itemKey, attr.key) ?? findStoredKey(baselineEdits, item.itemKey, attr.key) ?? reviewKey(item.itemKey, attr.key);
    const current = edits[storedKey];
    const baseline = baselineEdits[storedKey];
    const normalizedNote = note?.trim() || null;

    let decision = current?.decision ?? '';

    if (normalizedNote != null && decision === '' && baseline?.decision !== 'accept') {
      // Auto-accept when adding a note to an untouched attribute
      decision = 'accept';
    } else if (normalizedNote == null && decision === 'accept') {
      // Reverse auto-accept if clearing note and attribute was only accepted due to the note
      const wasAutoAccepted = !baseline || baseline.decision === '';
      const hasNoOtherChanges = current?.reviewedValue == null && current?.reasonCode == null;
      if (wasAutoAccepted && hasNoOtherChanges) {
        decision = '';
      }
    }

    get().updateAttribute(item.itemKey, attr.key, {
      itemKey: item.itemKey,
      itemType: item.itemType,
      attributeKey: attr.key,
      decision,
      originalValue: attr.originalValue,
      note: normalizedNote,
    });
  },

  saveDraft: async () => {
    const { reviewId, notes, edits } = get();
    if (!reviewId) return;
    set({ status: 'saving' });
    try {
      const payload = toPayload(notes, edits);
      const updated = await saveReviewDraft(reviewId, payload);
      const newEdits = buildEditsFromReview(updated);
      set({
        status: 'reviewing',
        edits: newEdits,
        baselineEdits: { ...newEdits },
        notes: updated.notes ?? '',
      });
      notificationService.success('Draft saved');
    } catch (err) {
      set({ status: 'reviewing' });
      notificationService.error(err instanceof Error ? err.message : 'Failed to save draft');
    }
  },

  finalize: async () => {
    const { reviewId, notes, edits } = get();
    if (!reviewId) return;
    set({ status: 'finalizing' });
    try {
      const payload = toPayload(notes, edits);
      await finalizeReview(reviewId, payload);
      notificationService.success('Review finalized');
      set({ status: 'exiting' });
      // Delay reset to allow exit animation
      setTimeout(() => get().exitReview(), 500);
    } catch (err) {
      set({ status: 'reviewing' });
      notificationService.error(err instanceof Error ? err.message : 'Failed to finalize review');
    }
  },

  discardDraft: async () => {
    const { reviewId } = get();
    if (!reviewId) return;
    set({ status: 'saving' });
    try {
      await discardReviewDraft(reviewId);
      notificationService.success('Draft discarded');
      set({ status: 'exiting' });
      setTimeout(() => get().exitReview(), 500);
    } catch (err) {
      set({ status: 'reviewing' });
      notificationService.error(err instanceof Error ? err.message : 'Failed to discard draft');
    }
  },

  exitReview: () => {
    set(INITIAL_STATE);
  },

  getEdit: (itemKey, attrKey) => {
    const { edits } = get();
    const storedKey = findStoredKey(edits, itemKey, attrKey);
    return storedKey ? edits[storedKey] : undefined;
  },

  isAttributeSaved: (itemKey, attrKey) => {
    const { baselineEdits } = get();
    const storedKey = findStoredKey(baselineEdits, itemKey, attrKey);
    if (!storedKey) return false;
    const baseline = baselineEdits[storedKey];
    return !!baseline && baseline.decision !== '';
  },

  getDirty: () => {
    const { edits, baselineEdits } = get();
    const result = computeDirty(edits, baselineEdits);
    return { ...result, isDirty: result.dirtyCount > 0 };
  },
}));
