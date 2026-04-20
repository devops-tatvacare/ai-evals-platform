import { useMemo } from 'react';
import type { ReviewableItem } from '@/types';
import { useInlineReviewOptional } from './inline/InlineReviewProvider';
import { useReviewOverrides } from './useReviewOverrides';
import { stripReviewItemPrefix, reviewEditKey } from './keys';

export interface ReviewTableData {
  /** Map from raw id (stripped of `<type>:` prefix) to the ReviewableItem. */
  reviewableItems: Map<string, ReviewableItem> | undefined;
  /** Set of raw ids with at least one non-empty review decision in the active draft. */
  reviewedIds: Set<string> | undefined;
  /** Map from raw id -> attributeKey -> reviewedValue, merged from live draft + persisted review. */
  humanVerdicts: Map<string, Map<string, string>> | undefined;
}

/**
 * Shared plumbing for review-aware list surfaces (adversarial, batch, inside sales, etc).
 *
 * Returns the three pieces every list needs: the reviewable items for this surface,
 * the set of ids the reviewer has touched, and the map of overridden attribute values
 * to render in place of the AI verdict.
 *
 * Pass `itemType` to restrict the surface to a subset of the run's review context
 * (e.g. `'adversarial'`, `'call'`). Omit it when the run's context is single-typed
 * (e.g. batch kaira runs contain only `thread:*`).
 */
export function useReviewTableData(
  runId: string | undefined,
  opts?: { itemType?: string },
): ReviewTableData {
  const review = useInlineReviewOptional();
  const { overrides } = useReviewOverrides(runId);
  const itemType = opts?.itemType;

  const contextItems = review?.context?.items;
  const edits = review?.edits;

  const reviewableItems = useMemo(() => {
    if (!contextItems) return undefined;
    const map = new Map<string, ReviewableItem>();
    for (const item of contextItems) {
      if (itemType && item.itemType !== itemType) continue;
      map.set(stripReviewItemPrefix(item.itemKey), item);
    }
    return map.size > 0 ? map : undefined;
  }, [contextItems, itemType]);

  const reviewedIds = useMemo(() => {
    if (!contextItems || !reviewableItems) return undefined;
    const set = new Set<string>();
    for (const item of contextItems) {
      if (itemType && item.itemType !== itemType) continue;
      const hasDecision = item.attributes.some((attr) => {
        const edit = edits?.[reviewEditKey(item.itemKey, attr.key)];
        return !!edit && edit.decision !== '';
      });
      if (hasDecision) set.add(stripReviewItemPrefix(item.itemKey));
    }
    return set;
  }, [contextItems, reviewableItems, itemType, edits]);

  const humanVerdicts = useMemo(() => {
    if (overrides.length === 0) return undefined;
    const map = new Map<string, Map<string, string>>();
    for (const ovr of overrides) {
      if (itemType && !ovr.itemKey.startsWith(`${itemType}:`)) continue;
      const rawId = stripReviewItemPrefix(ovr.itemKey);
      let attrMap = map.get(rawId);
      if (!attrMap) {
        attrMap = new Map();
        map.set(rawId, attrMap);
      }
      attrMap.set(ovr.attributeKey, ovr.reviewedValue);
    }
    return map.size > 0 ? map : undefined;
  }, [overrides, itemType]);

  return { reviewableItems, reviewedIds, humanVerdicts };
}

/**
 * Resolve the effective value of an item's attribute: the reviewer's override
 * when present, otherwise the AI value.
 *
 * Intended as the single call-site primitive for recomputing summary metrics
 * (pass rate, distribution, avg score) across app-specific surfaces. Any run
 * page that wants human-aware KPIs should reduce its rows through this helper
 * instead of reading `canonical.judge.verdict` directly.
 */
export function getEffectiveAttribute<T extends string | null | undefined>(
  humanVerdicts: Map<string, Map<string, string>> | undefined,
  itemKey: string,
  attrKey: string,
  aiValue: T,
): T | string {
  const override = humanVerdicts?.get(itemKey)?.get(attrKey);
  return override != null ? override : aiValue;
}
