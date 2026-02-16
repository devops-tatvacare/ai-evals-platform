import { memo } from 'react';
import { cn } from '@/utils';
import type { TranscriptSegment as TranscriptSegmentType } from '@/types';

// Speaker colors for visual distinction
const SPEAKER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Doctor: {
    bg: 'bg-[var(--color-info-light)]',
    text: 'text-[var(--color-info)]',
    border: 'border-[var(--color-info)]/30',
  },
  Patient: {
    bg: 'bg-[var(--color-success-light)]',
    text: 'text-[var(--color-success)]',
    border: 'border-[var(--color-success)]/30',
  },
  default: {
    bg: 'bg-[var(--color-brand-accent)]/20',
    text: 'text-[var(--text-brand)]',
    border: 'border-[var(--text-brand)]/30',
  },
};

function getSpeakerColor(speaker: string) {
  return SPEAKER_COLORS[speaker] || SPEAKER_COLORS.default;
}

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  isActive?: boolean;
  onClick?: () => void;
}

export const TranscriptSegment = memo(function TranscriptSegment({
  segment,
  isActive,
  onClick,
}: TranscriptSegmentProps) {
  const colors = getSpeakerColor(segment.speaker);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1',
        'hover:shadow-sm',
        isActive
          ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-accent)]/10 shadow-sm'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Speaker badge */}
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
            colors.bg,
            colors.text
          )}
        >
          {segment.speaker}
        </span>

        {/* Timestamp */}
        <span className="flex-shrink-0 font-mono text-[11px] text-[var(--text-muted)]">
          {segment.startTime}
        </span>
      </div>

      {/* Text content */}
      <p className={cn(
        'mt-2 text-[14px] leading-relaxed',
        isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
      )}>
        {segment.text}
      </p>
    </button>
  );
});
