import { memo } from 'react';
import { MessageSquare, Check, HelpCircle } from 'lucide-react';
import { cn } from '@/utils';
import { Badge } from '@/components/ui';
import type { SegmentCritique, CritiqueSeverity, LikelyCorrect } from '@/types';

interface SegmentCritiqueCardProps {
  critique: SegmentCritique;
  className?: string;
}

const SEVERITY_CONFIG: Record<CritiqueSeverity, { variant: 'success' | 'primary' | 'warning' | 'error'; label: string }> = {
  none: { variant: 'success', label: 'Match' },
  minor: { variant: 'primary', label: 'Minor' },
  moderate: { variant: 'warning', label: 'Moderate' },
  critical: { variant: 'error', label: 'Critical' },
};

const SEVERITY_CARD_STYLES: Record<CritiqueSeverity, string> = {
  none: 'bg-[var(--color-success-light)] border-[var(--color-success)]/30',
  minor: 'bg-[var(--color-info-light)] border-[var(--color-info)]/30',
  moderate: 'bg-[var(--color-warning-light)] border-[var(--color-warning)]/30',
  critical: 'bg-[var(--color-error-light)] border-[var(--color-error)]/30',
};

const SEVERITY_ICON_STYLES: Record<CritiqueSeverity, string> = {
  none: 'text-[var(--color-success)]',
  minor: 'text-[var(--color-info)]',
  moderate: 'text-[var(--color-warning)]',
  critical: 'text-[var(--color-error)]',
};

const LIKELY_CORRECT_LABELS: Record<LikelyCorrect, string> = {
  original: 'Original AI likely correct',
  judge: 'Judge AI likely correct',
  both: 'Both match',
  unclear: 'Needs human review',
};

export const SegmentCritiqueCard = memo(function SegmentCritiqueCard({
  critique,
  className,
}: SegmentCritiqueCardProps) {
  const config = SEVERITY_CONFIG[critique.severity];

  // Don't show card if severity is "none" and it's a match
  if (critique.severity === 'none' && critique.likelyCorrect === 'both') {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-2 rounded-[var(--radius-default)] border p-2',
        SEVERITY_CARD_STYLES[critique.severity],
        className
      )}
    >
      <div className="flex items-start gap-2">
        <MessageSquare className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', SEVERITY_ICON_STYLES[critique.severity])} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant={config.variant} className="text-[10px]">
              {config.label}
            </Badge>
            {critique.likelyCorrect && critique.likelyCorrect !== 'both' && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)]',
                critique.likelyCorrect === 'unclear' 
                  ? 'bg-[var(--color-warning-light)] text-[var(--color-warning)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              )}>
                {critique.likelyCorrect === 'unclear' ? (
                  <HelpCircle className="h-2.5 w-2.5" />
                ) : (
                  <Check className="h-2.5 w-2.5" />
                )}
                {LIKELY_CORRECT_LABELS[critique.likelyCorrect]}
              </span>
            )}
            {critique.category && (
              <span className="text-[10px] text-[var(--text-muted)] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-tertiary)]">
                {critique.category}
              </span>
            )}
            {critique.confidence && (
              <span className="text-[10px] text-[var(--text-muted)] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--bg-tertiary)]">
                {critique.confidence} confidence
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            {critique.discrepancy}
          </p>
        </div>
      </div>
    </div>
  );
});
