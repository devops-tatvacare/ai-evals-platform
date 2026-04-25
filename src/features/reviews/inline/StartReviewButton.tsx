import { Loader2, Lock, UserRoundPen } from 'lucide-react';
import { ActionIconButton } from '@/features/evalRuns/components/RunHeaderActions';
import { ReviewLockTooltip } from '../ReviewLockTooltip';
import { useRunReviewMeta } from '../reviewOverridesStore';
import { useInlineReviewOptional } from './InlineReviewProvider';

interface StartReviewButtonProps {
  runId: string;
}

export function StartReviewButton({ runId }: StartReviewButtonProps) {
  const review = useInlineReviewOptional();
  const { activeDraft } = useRunReviewMeta(runId);
  if (!review || review.isEditing) return null;
  const lockedByOther = !!activeDraft && !activeDraft.isMine;
  const button = (
    <ActionIconButton
      icon={review.loading ? Loader2 : lockedByOther ? Lock : UserRoundPen}
      label="Start human review"
      tooltip={
        review.loading
          ? 'Loading review…'
          : lockedByOther
          ? undefined
          : 'Start human review'
      }
      onClick={lockedByOther || review.loading ? undefined : review.startDraft}
      spinning={review.loading}
      disabled={lockedByOther || review.loading}
    />
  );
  if (lockedByOther && activeDraft) {
    return <ReviewLockTooltip activeDraft={activeDraft}>{button}</ReviewLockTooltip>;
  }
  return button;
}
