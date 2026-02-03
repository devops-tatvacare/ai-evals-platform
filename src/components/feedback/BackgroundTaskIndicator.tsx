import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, ChevronUp, ChevronDown, StopCircle } from 'lucide-react';
import { useTaskQueueStore } from '@/stores';
import { taskCancellationRegistry } from '@/services/taskCancellation';
import { cn } from '@/utils';
import type { EvaluationStage, EvaluationCallNumber } from '@/types';

interface TaskProgress {
  stage: EvaluationStage;
  message: string;
  callNumber?: EvaluationCallNumber;
  progress?: number;
}

function getStageLabel(stage: EvaluationStage, callNumber?: EvaluationCallNumber): string {
  switch (stage) {
    case 'preparing':
      return 'Preparing';
    case 'normalizing':
      return 'Normalizing transcript';
    case 'transcribing':
      return `Call ${callNumber || 1}: Transcribing`;
    case 'critiquing':
      return `Call ${callNumber || 2}: Evaluating`;
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

function getOverallProgress(stage: EvaluationStage, progress?: number): number {
  const stageWeights: Record<EvaluationStage, [number, number]> = {
    preparing: [0, 10],
    normalizing: [10, 15],
    transcribing: [15, 50],
    critiquing: [50, 85],
    comparing: [85, 95],
    complete: [95, 100],
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
  
  // Get active AI eval tasks
  const activeTasks = tasks.filter(
    (task) => 
      task.type === 'ai_eval' && 
      (task.status === 'pending' || task.status === 'processing')
  );
  
  // Get recently completed/failed tasks (within last 5 seconds)
  const completedTasks = tasks.filter(
    (task) =>
      task.type === 'ai_eval' &&
      (task.status === 'completed' || task.status === 'failed') &&
      task.completedAt &&
      Date.now() - new Date(task.completedAt).getTime() < 5000
  );
  
  // Auto-dismiss completed tasks after 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const toRemove = tasks.filter(
        (task) =>
          task.type === 'ai_eval' &&
          (task.status === 'completed' || task.status === 'failed') &&
          task.completedAt &&
          Date.now() - new Date(task.completedAt).getTime() >= 5000
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
        
        const taskProgress: TaskProgress = {
          stage: task.stage || 'preparing',
          message: task.error || getStageLabel(task.stage || 'preparing', task.callNumber),
          callNumber: task.callNumber,
          progress: task.progress,
        };
        
        const overallProgress = getOverallProgress(taskProgress.stage, taskProgress.progress);
        
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
                  'text-[12px] leading-relaxed whitespace-pre-line',
                  isFailed ? 'text-[var(--color-error)]' : 'text-[var(--text-secondary)]'
                )}>
                  {taskProgress.message}
                </div>
                {isActive && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {Math.round(overallProgress)}% complete
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {taskProgress.callNumber 
                        ? `Call ${taskProgress.callNumber}/2`
                        : 'Preparing'
                      }
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
