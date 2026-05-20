import { useReviewModeStore } from '@/stores/reviewModeStore';

/**
 * True when an inline review session is active for the given run.
 *
 * Run-detail surfaces use this to hide header actions (delete / cancel /
 * visibility / start-review) while the user is reviewing — the review chrome
 * owns those affordances. Run-detail config gates whether the surface
 * participates in review mode (`extras.review`); this hook only resolves the
 * active state for the run currently on screen.
 */
export function useReviewMode(runId: string | undefined): boolean {
  const active = useReviewModeStore((s) => s.active);
  const activeRunId = useReviewModeStore((s) => s.runId);
  return !!runId && active && activeRunId === runId;
}
