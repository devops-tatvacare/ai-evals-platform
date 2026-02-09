import { memo } from 'react';
import { cn } from '@/utils';
import { Button } from '@/components/ui';
import type { EvaluationStage } from '@/types';

interface StepConfig {
  includeTranscription: boolean;
  includeNormalization: boolean;
  includeCritique: boolean;
}

interface EvaluationProgressProps {
  stage: EvaluationStage;
  message: string;
  currentStep?: number;
  totalSteps?: number;
  steps?: StepConfig;
  progress?: number;
  onCancel?: () => void;
  className?: string;
}

/** Build dynamic stage list from the step configuration */
function buildStages(steps?: StepConfig): { key: EvaluationStage; label: string }[] {
  const stages: { key: EvaluationStage; label: string }[] = [
    { key: 'preparing', label: 'Prepare' },
  ];

  if (steps) {
    if (steps.includeTranscription) stages.push({ key: 'transcribing', label: 'Transcription' });
    if (steps.includeNormalization) stages.push({ key: 'normalizing', label: 'Normalization' });
    if (steps.includeCritique) stages.push({ key: 'critiquing', label: 'Evaluation' });
  } else {
    // Fallback when steps config is not available
    stages.push({ key: 'transcribing', label: 'Transcription' });
    stages.push({ key: 'critiquing', label: 'Evaluation' });
  }

  stages.push({ key: 'complete', label: 'Done' });
  return stages;
}

function getStageIndex(stages: { key: EvaluationStage }[], stage: EvaluationStage): number {
  const idx = stages.findIndex((s) => s.key === stage);
  return idx === -1 ? 0 : idx;
}

export const EvaluationProgress = memo(function EvaluationProgress({
  stage,
  message,
  currentStep,
  totalSteps,
  steps,
  progress,
  onCancel,
  className,
}: EvaluationProgressProps) {
  const dynamicStages = buildStages(steps);
  const currentIndex = getStageIndex(dynamicStages, stage);
  const isFailed = stage === 'failed';

  // Build step label: "Step 1/3: Transcription"
  const stepLabel = currentStep && totalSteps
    ? `Step ${currentStep}/${totalSteps}`
    : '';

  return (
    <div className={cn('space-y-4', className)}>
      {/* Stage indicators */}
      <div className="flex items-center justify-between">
        {dynamicStages.map((s, index) => {
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
                {index < dynamicStages.length - 1 && (
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
          {stepLabel ? `${stepLabel}: ` : ''}
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
