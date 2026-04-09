import { cn } from '@/utils/cn';
import type { ReviewDecision } from '@/types';

type ReviewBadgeState = 'untouched' | 'accepted' | 'overridden' | 'draft';

interface InlineReviewBadgeProps {
  decision: ReviewDecision | '' | null | undefined;
  isDraft?: boolean;
}

const STATE_STYLES: Record<ReviewBadgeState, string> = {
  untouched: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-subtle)]',
  accepted: 'bg-[var(--surface-success)] text-[var(--color-success)] border-[var(--color-success)]/20',
  overridden: 'bg-[var(--surface-warning)] text-[var(--color-warning)] border-[var(--color-warning)]/20',
  draft: 'bg-[color-mix(in_srgb,var(--interactive-primary)_10%,transparent)] text-[var(--text-brand)] border-[var(--interactive-primary)]/25',
};

const STATE_LABELS: Record<ReviewBadgeState, string> = {
  untouched: '\u2014',
  accepted: '\u2713 Accepted',
  overridden: '\u270E Overridden',
  draft: '\u270E Draft',
};

function resolveState(decision: ReviewDecision | '' | null | undefined, isDraft: boolean): ReviewBadgeState {
  if (!decision) return 'untouched';
  if (isDraft) return 'draft';
  if (decision === 'accept') return 'accepted';
  return 'overridden'; // reject or correct
}

export function InlineReviewBadge({ decision, isDraft = false }: InlineReviewBadgeProps) {
  const state = resolveState(decision, isDraft);
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[8px] font-bold uppercase tracking-wide',
      STATE_STYLES[state],
    )}>
      {STATE_LABELS[state]}
    </span>
  );
}
