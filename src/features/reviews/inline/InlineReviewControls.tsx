import { Check, PenLine, MessageCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { ReviewDecision } from '@/types';

interface InlineReviewControlsProps {
  decision: ReviewDecision | '' | null | undefined;
  noteCount?: number;
  disabled?: boolean;
  onAccept: () => void;
  onOverride: () => void;
  onNote: () => void;
}

export function InlineReviewControls({
  decision,
  noteCount = 0,
  disabled = false,
  onAccept,
  onOverride,
  onNote,
}: InlineReviewControlsProps) {
  if (disabled) return null;

  const isAccepted = decision === 'accept';
  const isOverridden = decision === 'reject' || decision === 'correct';
  const hasNote = noteCount > 0;

  return (
    <span className="inline-flex items-center gap-px rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-px">
      <button
        type="button"
        onClick={onAccept}
        className={cn(
          'inline-flex items-center justify-center w-[22px] h-5 rounded transition-colors',
          isAccepted
            ? 'bg-[var(--surface-success)] text-[var(--color-success)]'
            : 'text-[var(--text-muted)] hover:text-[var(--color-success)] hover:bg-[var(--surface-success)]',
        )}
        title="Accept"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onOverride}
        className={cn(
          'inline-flex items-center justify-center w-[22px] h-5 rounded transition-colors',
          isOverridden
            ? 'bg-[var(--surface-warning)] text-[var(--color-warning)]'
            : 'text-[var(--text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--surface-warning)]',
        )}
        title="Override"
      >
        <PenLine className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onNote}
        className={cn(
          'inline-flex items-center justify-center w-[22px] h-5 rounded transition-colors',
          hasNote
            ? 'text-[var(--color-info)]'
            : 'text-[var(--text-muted)] hover:text-[var(--color-info)]',
        )}
        title="Note"
      >
        <MessageCircle className="h-3 w-3" />
      </button>
    </span>
  );
}
