import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { notificationService } from '@/services/notifications';
import { fetchHumanReview, upsertHumanReview } from '@/services/api/evalRunsApi';
import type {
  FlowType,
  HumanReview,
  HumanReviewResult,
  HumanReviewSummary,
  ReviewSchema,
  ReviewItem,
  SegmentReviewItem,
  FieldReviewItem,
  OverallVerdict,
  ReviewVerdict,
} from '@/types';

interface UseHumanReviewOptions {
  aiEvalRunId: string | undefined;
  flowType: FlowType;
  /** Total segment count (upload) or total field count (API) */
  totalItems: number;
}

interface UseHumanReviewReturn {
  /** Saved review from backend (null if none) */
  humanReview: HumanReview | null;
  /** Loading state */
  isLoading: boolean;
  /** Whether local state differs from saved */
  isDirty: boolean;
  /** Submit in progress */
  isSubmitting: boolean;
  /** Current segment review items map (upload flow) */
  segmentReviews: Map<number, SegmentReviewItem>;
  /** Current field review items map (API flow) */
  fieldReviews: Map<string, FieldReviewItem>;
  /** Update a single segment review */
  setSegmentReview: (index: number, review: SegmentReviewItem) => void;
  /** Update a single field review */
  setFieldReview: (fieldPath: string, review: FieldReviewItem) => void;
  /** Auto-computed from items */
  overallVerdict: OverallVerdict | null;
  /** Reviewed count */
  reviewedCount: number;
  /** Submit to backend */
  submit: (notes?: string, adjustedMetrics?: Record<string, number>) => Promise<void>;
  /** Discard local changes, revert to saved */
  discard: () => void;
}

function computeOverallVerdict(verdicts: ReviewVerdict[]): OverallVerdict | null {
  if (verdicts.length === 0) return null;
  if (verdicts.some(v => v === 'reject')) return 'rejected';
  if (verdicts.some(v => v === 'correct')) return 'accepted_with_corrections';
  return 'accepted';
}

/**
 * Manages human review state with backend persistence via eval_runs API.
 * Replaces the deprecated useHumanEvaluation hook.
 */
export function useHumanReview({
  aiEvalRunId,
  flowType,
  totalItems,
}: UseHumanReviewOptions): UseHumanReviewReturn {
  const [humanReview, setHumanReview] = useState<HumanReview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Working copies — one per flow type
  const [segmentReviews, setSegmentReviews] = useState<Map<number, SegmentReviewItem>>(new Map());
  const [fieldReviews, setFieldReviews] = useState<Map<string, FieldReviewItem>>(new Map());

  // Snapshot of saved state for dirty tracking
  const savedSegmentRef = useRef<Map<number, SegmentReviewItem>>(new Map());
  const savedFieldRef = useRef<Map<string, FieldReviewItem>>(new Map());

  // --- Fetch on mount ---
  useEffect(() => {
    if (!aiEvalRunId) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const review = await fetchHumanReview(aiEvalRunId!);
        if (cancelled) return;

        setHumanReview(review);

        if (review) {
          const items = review.result?.items ?? [];

          if (flowType === 'upload' || review.reviewSchema === 'segment_review') {
            const map = new Map<number, SegmentReviewItem>();
            for (const item of items) {
              if ('segmentIndex' in item) {
                map.set((item as SegmentReviewItem).segmentIndex, item as SegmentReviewItem);
              }
            }
            setSegmentReviews(map);
            savedSegmentRef.current = new Map(map);
          } else {
            const map = new Map<string, FieldReviewItem>();
            for (const item of items) {
              if ('fieldPath' in item) {
                map.set((item as FieldReviewItem).fieldPath, item as FieldReviewItem);
              }
            }
            setFieldReviews(map);
            savedFieldRef.current = new Map(map);
          }
        } else {
          // No saved review — start with empty maps
          setSegmentReviews(new Map());
          setFieldReviews(new Map());
          savedSegmentRef.current = new Map();
          savedFieldRef.current = new Map();
        }
      } catch {
        // Silently fail — absence is normal
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [aiEvalRunId, flowType]);

  // --- Dirty tracking ---
  const isDirty = useMemo(() => {
    if (flowType === 'upload' || flowType !== 'api') {
      const saved = savedSegmentRef.current;
      if (segmentReviews.size !== saved.size) return true;
      for (const [key, val] of segmentReviews) {
        const savedVal = saved.get(key);
        if (!savedVal) return true;
        if (savedVal.verdict !== val.verdict || savedVal.correctedText !== val.correctedText || savedVal.comment !== val.comment) return true;
      }
      return false;
    }

    // API flow
    const saved = savedFieldRef.current;
    if (fieldReviews.size !== saved.size) return true;
    for (const [key, val] of fieldReviews) {
      const savedVal = saved.get(key);
      if (!savedVal) return true;
      if (savedVal.verdict !== val.verdict || savedVal.comment !== val.comment) return true;
      // correctedValue is unknown, use JSON compare
      if (JSON.stringify(savedVal.correctedValue) !== JSON.stringify(val.correctedValue)) return true;
    }
    return false;
  }, [flowType, segmentReviews, fieldReviews]);

  // --- Item updates ---
  const setSegmentReview = useCallback((index: number, review: SegmentReviewItem) => {
    setSegmentReviews(prev => {
      const next = new Map(prev);
      next.set(index, review);
      return next;
    });
  }, []);

  const setFieldReview = useCallback((fieldPath: string, review: FieldReviewItem) => {
    setFieldReviews(prev => {
      const next = new Map(prev);
      next.set(fieldPath, review);
      return next;
    });
  }, []);

  // --- Computed values ---
  const reviewedCount = useMemo(() => {
    return flowType === 'api' ? fieldReviews.size : segmentReviews.size;
  }, [flowType, segmentReviews, fieldReviews]);

  const overallVerdict = useMemo(() => {
    const verdicts: ReviewVerdict[] = [];
    if (flowType === 'api') {
      for (const item of fieldReviews.values()) verdicts.push(item.verdict);
    } else {
      for (const item of segmentReviews.values()) verdicts.push(item.verdict);
    }
    return computeOverallVerdict(verdicts);
  }, [flowType, segmentReviews, fieldReviews]);

  // --- Submit ---
  const submit = useCallback(async (notes?: string, adjustedMetrics?: Record<string, number>) => {
    if (!aiEvalRunId) return;

    setIsSubmitting(true);
    try {
      const isApi = flowType === 'api';
      const reviewSchema: ReviewSchema = isApi ? 'field_review' : 'segment_review';

      // Build items array
      const items: ReviewItem[] = [];
      if (isApi) {
        for (const item of fieldReviews.values()) items.push(item);
      } else {
        for (const item of segmentReviews.values()) items.push(item);
      }

      const verdicts = items.map(i => 'verdict' in i ? i.verdict : undefined).filter(Boolean) as ReviewVerdict[];
      const verdict = computeOverallVerdict(verdicts) ?? 'accepted';

      // Count by verdict
      let accepted = 0;
      let rejected = 0;
      let corrected = 0;
      for (const v of verdicts) {
        if (v === 'accept') accepted++;
        else if (v === 'reject') rejected++;
        else if (v === 'correct') corrected++;
      }

      const result: HumanReviewResult = {
        overallVerdict: verdict,
        notes: notes ?? '',
        items,
      };

      const summary: HumanReviewSummary = {
        totalItems,
        accepted,
        rejected,
        corrected,
        unreviewed: totalItems - items.length,
        overallVerdict: verdict,
        adjustedMetrics: adjustedMetrics ?? {},
      };

      const saved = await upsertHumanReview(aiEvalRunId, {
        reviewSchema,
        result,
        summary,
      });

      setHumanReview(saved);

      // Update saved snapshots
      if (isApi) {
        savedFieldRef.current = new Map(fieldReviews);
      } else {
        savedSegmentRef.current = new Map(segmentReviews);
      }

      notificationService.success('Human review saved');
    } catch (err) {
      notificationService.error(
        err instanceof Error ? err.message : 'Failed to save human review',
        'Save Error',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [aiEvalRunId, flowType, totalItems, segmentReviews, fieldReviews]);

  // --- Discard ---
  const discard = useCallback(() => {
    if (flowType === 'api') {
      setFieldReviews(new Map(savedFieldRef.current));
    } else {
      setSegmentReviews(new Map(savedSegmentRef.current));
    }
  }, [flowType]);

  return {
    humanReview,
    isLoading,
    isDirty,
    isSubmitting,
    segmentReviews,
    fieldReviews,
    setSegmentReview,
    setFieldReview,
    overallVerdict,
    reviewedCount,
    submit,
    discard,
  };
}
