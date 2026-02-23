import { CheckCircle, Edit3, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { HumanReview, OverallVerdict } from '@/types';

interface HumanReviewStatusProps {
  humanReview: HumanReview | null;
  isDirty: boolean;
  reviewedCount: number;
  totalItems: number;
  overallVerdict: OverallVerdict | null;
}

const VERDICT_LABEL: Record<OverallVerdict, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  accepted_with_corrections: 'Corrections',
};

const VERDICT_VARIANT: Record<OverallVerdict, 'success' | 'error' | 'warning'> = {
  accepted: 'success',
  rejected: 'error',
  accepted_with_corrections: 'warning',
};

export function HumanReviewStatus({
  humanReview,
  isDirty,
  reviewedCount,
  totalItems,
  overallVerdict,
}: HumanReviewStatusProps) {
  const hasSaved = !!humanReview;

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
      {/* Status icon + badge */}
      <div className="flex items-center gap-2">
        {hasSaved ? (
          <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
        ) : (
          <Edit3 className="h-4 w-4 text-[var(--text-muted)]" />
        )}
        <Badge variant={hasSaved ? 'success' : 'neutral'} className="text-[10px]">
          {hasSaved ? 'Submitted' : 'Not Submitted'}
        </Badge>
      </div>

      <div className="h-4 w-px bg-[var(--border-default)]" />

      {/* Reviewed count */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-[var(--text-muted)]">Reviewed:</span>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          {reviewedCount}/{totalItems}
        </span>
      </div>

      {/* Overall verdict badge */}
      {overallVerdict && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          <Badge variant={VERDICT_VARIANT[overallVerdict]} className="text-[10px]">
            {VERDICT_LABEL[overallVerdict]}
          </Badge>
        </>
      )}

      {/* Dirty indicator */}
      {isDirty && (
        <>
          <div className="h-4 w-px bg-[var(--border-default)]" />
          <div className="flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
            <span className="text-[11px] text-[var(--color-warning)]">Unsaved changes</span>
          </div>
        </>
      )}

      {/* Timestamp — pushed to right */}
      {humanReview?.completedAt && (
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {new Date(humanReview.completedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}
