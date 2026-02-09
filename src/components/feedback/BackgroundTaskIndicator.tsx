import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, ChevronUp, ChevronDown, StopCircle } from 'lucide-react';
import { useTaskQueueStore } from '@/stores';
import { taskCancellationRegistry } from '@/services/taskCancellation';
import { cn } from '@/utils';
import type { EvaluationStage } from '@/types';

/** Map stage enum to a human-readable step name */
function getStepNameForStage(
  stage: EvaluationStage,
): string {
  switch (stage) {
    case 'preparing':
      return 'Preparing';
    case 'transcribing':
      return 'Transcription';
    case 'normalizing':
      return 'Normalization';
    case 'critiquing':
      return 'Evaluation';
    case 'comparing':
      return 'Computing metrics';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    default:
      return 'Processing';
  }
}

/** Build the step label: "Step 1/3 · Transcription" */
function getStepLabel(
  stage: EvaluationStage,
  currentStep?: number,
  totalSteps?: number,
): string {
  if (stage === 'complete') return 'Complete';
  if (stage === 'failed') return 'Failed';
  if (stage === 'preparing') return 'Preparing';

  const stepName = getStepNameForStage(stage);

  if (currentStep && totalSteps && totalSteps > 0) {
    return `Step ${currentStep}/${totalSteps} · ${stepName}`;
  }

  return stepName;
}

function getOverallProgress(
  stage: EvaluationStage, 
  progress?: number,
  currentStep?: number,
  totalSteps?: number
): number {
  if (stage === 'complete') return 100;
  
  if (currentStep && totalSteps && totalSteps > 0) {
    if (currentStep === totalSteps && progress === 100) return 100;
    
    const baseProgress = ((currentStep - 1) / totalSteps) * 100;
    const stepProgress = progress !== undefined ? progress : 0;
    const stepWeight = 100 / totalSteps;
    return Math.min(100, baseProgress + (stepWeight * stepProgress / 100));
  }
  
  // Fallback to stage-based weights
  const stageWeights: Record<EvaluationStage, [number, number]> = {
    preparing: [0, 10],
    normalizing: [10, 30],
    transcribing: [30, 60],
    critiquing: [60, 90],
    comparing: [90, 95],
    complete: [100, 100],
    failed: [0, 0],
  };
  
  const [min, max] = stageWeights[stage] || [0, 0];
  if (progress !== undefined) {
    return min + ((max - min) * progress) / 100;
  }
  return min;
}

export function BackgroundTaskIndicator() {
  const { tasks, removeTask, setTaskStatus } = useTaskQueueStore();
  const [isExpanded, setIsExpanded] = useState(true);
  const [recentlyCompleted, setRecentlyCompleted] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  
  const activeTasks = tasks.filter(
    (task) => 
      task.type === 'ai_eval' && 
      (task.status === 'pending' || task.status === 'processing')
  );
  
  const completedTasks = tasks.filter(
    (task) =>
      task.type === 'ai_eval' &&
      (task.status === 'completed' || task.status === 'failed') &&
      task.completedAt &&
      now - new Date(task.completedAt).getTime() < 5000
  );
  
  useEffect(() => {
    const interval = setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);
      const toRemove = tasks.filter(
        (task) =>
          task.type === 'ai_eval' &&
          (task.status === 'completed' || task.status === 'failed') &&
          task.completedAt &&
          currentNow - new Date(task.completedAt).getTime() >= 5000
      );
      toRemove.forEach((task) => {
        if (!recentlyCompleted.includes(task.id)) {
          setRecentlyCompleted((prev) => [...prev, task.id]);
        }
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [tasks, recentlyCompleted]);
  
  const visibleTasks = [...activeTasks, ...completedTasks.filter(t => !recentlyCompleted.includes(t.id))];
  
  if (visibleTasks.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-sm">
      {visibleTasks.map((task) => {
        const isActive = task.status === 'pending' || task.status === 'processing';
        const isCompleted = task.status === 'completed';
        const isFailed = task.status === 'failed';
        
        const currentStage = task.stage || 'preparing';
        
        const stepLabel = task.error 
          ? task.error 
          : getStepLabel(currentStage, task.currentStep, task.totalSteps);
        
        const overallProgress = getOverallProgress(
          currentStage,
          task.progress,
          task.currentStep,
          task.totalSteps
        );
        
        return (
          <div
            key={task.id}
            className={cn(
              'rounded-lg shadow-lg border overflow-hidden transition-all duration-300',
              'bg-[var(--bg-elevated)] border-[var(--border-default)]',
              isCompleted && 'border-[var(--color-success)]/50',
              isFailed && 'border-[var(--color-error)]/50'
            )}
          >
            {/* Header */}
            <div 
              className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--bg-secondary)]/50"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <div className="flex items-center gap-2">
                {isActive && (
                  <Loader2 className="h-4 w-4 text-[var(--color-brand-primary)] animate-spin" />
                )}
                {isCompleted && (
                  <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                )}
                {isFailed && (
                  <AlertCircle className="h-4 w-4 text-[var(--color-error)]" />
                )}
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  AI Evaluation
                </span>
              </div>
              <div className="flex items-center gap-1">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
                )}
                {isActive ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const success = taskCancellationRegistry.cancel(task.id);
                      if (success) {
                        setTaskStatus(task.id, 'cancelled', 'Cancelled by user');
                      }
                    }}
                    className="p-1 rounded hover:bg-[var(--color-error)]/10 text-[var(--color-error)] hover:text-[var(--color-error)] transition-colors"
                    title="Abort evaluation"
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTask(task.id);
                    }}
                    className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            
            {/* Progress bar */}
            {isActive && (
              <div className="h-1 bg-[var(--bg-tertiary)]">
                <div
                  className="h-full bg-[var(--color-brand-primary)] transition-all duration-300"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            )}
            
            {/* Expanded content */}
            {isExpanded && (
              <div className="px-3 py-2 border-t border-[var(--border-subtle)]">
                <div className={cn(
                  'text-[12px] leading-relaxed',
                  isFailed ? 'text-[var(--color-error)]' : 'text-[var(--text-secondary)]'
                )}>
                  {stepLabel}
                </div>
                {isActive && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {Math.round(overallProgress)}% complete
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
