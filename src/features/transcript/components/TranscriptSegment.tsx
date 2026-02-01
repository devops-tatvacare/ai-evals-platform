import { memo } from 'react';
import { cn } from '@/utils';
import type { TranscriptSegment as TranscriptSegmentType } from '@/types';

// Speaker colors for visual distinction
const SPEAKER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Doctor: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/30',
  },
  Patient: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/30',
  },
  default: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-600 dark:text-purple-400',
    border: 'border-purple-500/30',
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
        'group w-full rounded-lg border p-3 text-left transition-all',
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
