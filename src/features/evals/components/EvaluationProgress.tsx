import { memo } from 'react';
import { cn } from '@/utils';
import { Button } from '@/components/ui';
import type { EvaluationStage, EvaluationCallNumber } from '@/types';

interface EvaluationProgressProps {
  stage: EvaluationStage;
  message: string;
  callNumber?: EvaluationCallNumber;
  progress?: number;
  onCancel?: () => void;
  className?: string;
}

const STAGES: { key: EvaluationStage; label: string }[] = [
  { key: 'preparing', label: 'Prepare' },
  { key: 'transcribing', label: 'Call 1' },
  { key: 'critiquing', label: 'Call 2' },
  { key: 'comparing', label: 'Compare' },
  { key: 'complete', label: 'Done' },
];

function getStageIndex(stage: EvaluationStage): number {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return idx === -1 ? 0 : idx;
}

export const EvaluationProgress = memo(function EvaluationProgress({
  stage,
  message,
  callNumber,
  progress,
  onCancel,
  className,
}: EvaluationProgressProps) {
  const currentIndex = getStageIndex(stage);
  const isFailed = stage === 'failed';

  return (
    <div className={cn('space-y-4', className)}>
      {/* Stage indicators */}
      <div className="flex items-center justify-between">
        {STAGES.map((s, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex && !isFailed;
          const isPending = index > currentIndex;

          return (
            <div key={s.key} className="flex flex-col items-center flex-1">
              {/* Connector line */}
              <div className="flex items-center w-full">
                {index > 0 && (
                  <div
                    className={cn(
                      'flex-1 h-0.5 transition-colors',
                      isCompleted || isCurrent
                        ? 'bg-[var(--color-brand-primary)]'
                        : 'bg-[var(--border-subtle)]'
                    )}
                  />
                )}
                {/* Circle */}
                <div
                  className={cn(
                    'w-3 h-3 rounded-full border-2 transition-colors shrink-0',
                    isCompleted && 'bg-[var(--color-brand-primary)] border-[var(--color-brand-primary)]',
                    isCurrent && 'border-[var(--color-brand-primary)] bg-[var(--bg-primary)]',
                    isPending && 'border-[var(--border-default)] bg-[var(--bg-primary)]',
                    isFailed && index === currentIndex && 'border-[var(--color-error)] bg-[var(--color-error)]'
                  )}
                />
                {index < STAGES.length - 1 && (
                  <div
                    className={cn(
                      'flex-1 h-0.5 transition-colors',
                      isCompleted
                        ? 'bg-[var(--color-brand-primary)]'
                        : 'bg-[var(--border-subtle)]'
                    )}
                  />
                )}
              </div>
              {/* Label */}
              <span
                className={cn(
                  'text-[10px] mt-1 transition-colors',
                  isCurrent ? 'text-[var(--color-brand-primary)] font-medium' : 'text-[var(--text-muted)]'
                )}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current status message */}
      <div className="flex items-center justify-center gap-2">
        {!isFailed && stage !== 'complete' && (
          <div className="h-4 w-4 border-2 border-[var(--color-brand-primary)] border-t-transparent rounded-full animate-spin" />
        )}
        <span className={cn(
          'text-[13px]',
          isFailed ? 'text-[var(--color-error)]' : 'text-[var(--text-secondary)]'
        )}>
          {callNumber ? `Call ${callNumber}/2: ` : ''}
          {message}
        </span>
      </div>

      {/* Progress bar */}
      {progress !== undefined && progress > 0 && progress < 100 && (
        <div className="h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-brand-primary)] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Cancel button */}
      {onCancel && stage !== 'complete' && !isFailed && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
});
