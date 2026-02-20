/**
 * useUnifiedEvaluation Hook
 *
 * Submits evaluation as a backend job and polls for completion.
 * This is the recommended hook for new code.
 */

import { useState, useCallback, useRef } from 'react';
import { useLLMSettingsStore, useTaskQueueStore, useAppStore, useGlobalSettingsStore, useJobTrackerStore } from '@/stores';
import { notificationService } from '@/services/notifications';
import { logEvaluationStart, logEvaluationComplete, logEvaluationFailed, logEvaluationFlowSelected } from '@/services/logger';
import { submitAndPollJob, cancelJob } from '@/services/api/jobPolling';
import { taskCancellationRegistry } from '@/services/taskCancellation';
import { fetchLatestRun } from '@/services/api/evalRunsApi';
import type {
  AIEvaluation,
  Listing,
  EvaluationProgressState,
} from '@/types';

/**
 * Simplified config for the hook — prompts/schemas loaded by backend.
 */
export interface UnifiedEvaluationConfig {
  /** Model to use for all pipeline steps (overrides global store default) */
  model?: string;
  /** Thinking level: "off", "low", "medium", "high" */
  thinking?: string;
  /** Enable normalization of original transcript */
  normalizeOriginal?: boolean;
  /** Prerequisites (defaults provided if not specified) */
  prerequisites?: import('@/types').EvaluationPrerequisites;
}

export interface UseUnifiedEvaluationReturn {
  /** Whether evaluation is in progress */
  isEvaluating: boolean;
  /** Error message if evaluation failed */
  error: string | null;
  /** Current progress message */
  progress: string;
  /** Detailed progress state */
  progressState: EvaluationProgressState | null;
  /** Run evaluation on a listing */
  evaluate: (listing: Listing, config?: UnifiedEvaluationConfig) => Promise<AIEvaluation | null>;
  /** Cancel in-progress evaluation */
  cancel: () => void;
}

export function useUnifiedEvaluation(): UseUnifiedEvaluationReturn {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [progressState, setProgressState] = useState<EvaluationProgressState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  const appId = useAppStore((state) => state.currentApp);
  const addTask = useTaskQueueStore((state) => state.addTask);
  const setTaskStatus = useTaskQueueStore((state) => state.setTaskStatus);
  const updateTask = useTaskQueueStore((state) => state.updateTask);
  const completeTask = useTaskQueueStore((state) => state.completeTask);

  const evaluate = useCallback(async (
    listing: Listing,
    config?: UnifiedEvaluationConfig
  ): Promise<AIEvaluation | null> => {
    // Use model from config (overlay selection) or fall back to store default
    const llm = useLLMSettingsStore.getState();
    const selectedModel = config?.model || llm.selectedModel;

    // Validate
    if (!listing.audioFile) {
      setError('No audio file available for this listing.');
      return null;
    }

    const isApiFlow = listing.sourceType === 'api';

    logEvaluationFlowSelected(listing.id, isApiFlow ? 'api' : 'segment', {
      sourceType: listing.sourceType,
    });

    const prerequisites = config?.prerequisites ?? {
      language: 'Hindi',
      sourceScript: 'auto',
      targetScript: 'roman',
      normalizationEnabled: false,
      normalizationTarget: 'both' as const,
      preserveCodeSwitching: true,
    };

    const includeNormalization = config?.normalizeOriginal ?? false;
    const totalSteps = includeNormalization ? 3 : 2;

    // Set up state
    setIsEvaluating(true);
    setError(null);
    setProgress('Submitting evaluation job...');
    setProgressState({
      currentStep: 'transcription',
      stepNumber: 1,
      totalSteps,
      stepProgress: 0,
      overallProgress: 0,
      message: 'Submitting job...',
    });

    logEvaluationStart(listing.id, {
      transcription: '[backend-managed]',
      evaluation: '[backend-managed]',
    });

    // Create task
    const taskId = addTask({
      listingId: listing.id,
      type: 'ai_eval',
      prompt: '[backend-managed]',
      inputSource: 'audio',
      stage: 'preparing',
      steps: {
        includeTranscription: true,
        includeNormalization,
        includeCritique: true,
      },
      currentStep: 0,
      totalSteps,
    });

    // Set up cancellation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    taskCancellationRegistry.register(taskId, () => {
      abortController.abort();
      if (activeJobIdRef.current) {
        cancelJob(activeJobIdRef.current).catch(() => {});
      }
    });

    try {
      setTaskStatus(taskId, 'processing');

      // Build job params — backend loads prompts/schemas internally
      const { timeouts } = useGlobalSettingsStore.getState();
      const jobParams: Record<string, unknown> = {
        listing_id: listing.id,
        app_id: appId,
        normalize_original: config?.normalizeOriginal ?? false,
        prerequisites: {
          language: prerequisites.language,
          sourceScript: prerequisites.sourceScript,
          targetScript: prerequisites.targetScript,
          preserveCodeSwitching: prerequisites.preserveCodeSwitching,
        },
        model: selectedModel,
        thinking: config?.thinking ?? "low",
        timeouts: {
          text_only: timeouts.textOnly,
          with_schema: timeouts.withSchema,
          with_audio: timeouts.withAudio,
          with_audio_and_schema: timeouts.withAudioAndSchema,
        },
      };

      // Submit and poll
      const completedJob = await submitAndPollJob(
        'evaluate-voice-rx',
        jobParams,
        {
          signal: abortController.signal,
          onJobCreated: (jobId) => {
            activeJobIdRef.current = jobId;
            useJobTrackerStore.getState().trackJob({
              jobId,
              appId,
              jobType: 'evaluate-voice-rx',
              label: 'AI Evaluation',
              trackedAt: Date.now(),
            });
          },
          onProgress: (jp) => {
            setProgress(jp.message);
            setProgressState({
              currentStep: _inferPipelineStep(jp.message),
              stepNumber: jp.current,
              totalSteps,
              stepProgress: 0,
              overallProgress: jp.total > 0 ? Math.round((jp.current / jp.total) * 100) : 0,
              message: jp.message,
            });
            updateTask(taskId, {
              stage: _inferStage(jp.message),
              currentStep: jp.current,
              progress: jp.total > 0 ? Math.round((jp.current / jp.total) * 100) : undefined,
            });
          },
        },
      );

      if (completedJob.status === 'failed') {
        throw new Error(completedJob.errorMessage || 'Evaluation failed');
      }

      if (completedJob.status === 'cancelled') {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // Fetch evaluation result from eval_runs API
      const latestRun = await fetchLatestRun({
        listing_id: listing.id,
        eval_type: 'full_evaluation',
      });
      const evaluation = (latestRun?.result as AIEvaluation | undefined) ?? undefined;

      if (!evaluation) {
        throw new Error('Evaluation completed but no result found in eval_runs');
      }

      completeTask(taskId, evaluation);

      logEvaluationComplete(listing.id, {
        segmentCount: evaluation.judgeOutput?.segments?.length ?? 0,
        critiqueCount: evaluation.critique?.segments?.length ?? 0,
        skippedTranscription: false,
      });

      notificationService.success('AI evaluation complete.');
      return evaluation;

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      const errorMessage = err instanceof Error ? err.message : 'AI evaluation failed';

      logEvaluationFailed(listing.id, 'transcription', errorMessage);

      setError(errorMessage);
      setProgressState({
        currentStep: 'evaluation',
        stepNumber: 0,
        totalSteps: 0,
        stepProgress: 0,
        overallProgress: 0,
        message: errorMessage,
        stage: 'failed',
      });
      setTaskStatus(taskId, 'failed', errorMessage);
      notificationService.error(errorMessage, 'AI Evaluation failed');

      return null;

    } finally {
      setIsEvaluating(false);
      setProgress('');
      abortControllerRef.current = null;
      activeJobIdRef.current = null;
      taskCancellationRegistry.unregister(taskId);
    }
  }, [appId, addTask, setTaskStatus, updateTask, completeTask]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    if (activeJobIdRef.current) {
      cancelJob(activeJobIdRef.current).catch(() => {});
    }
  }, []);

  return {
    isEvaluating,
    error,
    progress,
    progressState,
    evaluate,
    cancel,
  };
}

function _inferPipelineStep(message: string): import('@/types').PipelineStep {
  const lower = message.toLowerCase();
  if (lower.includes('transcrib')) return 'transcription';
  if (lower.includes('normaliz')) return 'normalization';
  return 'evaluation';
}

function _inferStage(message: string): import('@/types').EvaluationStage {
  const lower = message.toLowerCase();
  if (lower.includes('transcrib')) return 'transcribing';
  if (lower.includes('normaliz')) return 'normalizing';
  if (lower.includes('critiqu') || lower.includes('compar') || lower.includes('evaluat')) return 'critiquing';
  if (lower.includes('complete') || lower.includes('done')) return 'complete';
  return 'preparing';
}
