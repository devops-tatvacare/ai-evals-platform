/**
 * useUnifiedEvaluation Hook
 * 
 * New hook that uses the EvaluationPipeline for unified evaluation.
 * This is the recommended hook for new code. The legacy useAIEvaluation
 * hook is still available for backward compatibility.
 */

import { useState, useCallback, useRef } from 'react';
import { 
  EvaluationPipeline, 
  buildEvaluationConfig,
  type PipelineResult,
} from '@/services/evaluation';
import { useSettingsStore, useTaskQueueStore, useAppStore } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { logEvaluationStart, logEvaluationComplete, logEvaluationFailed, logEvaluationFlowSelected } from '@/services/logger';
import { taskCancellationRegistry } from '@/services/taskCancellation';
import type { 
  AIEvaluation,
  AIEvaluationV2,
  Listing, 
  EvaluationProgressState,
  PipelineStep,
} from '@/types';

/**
 * Simplified config for the hook (backward compatible with old hook)
 */
export interface UnifiedEvaluationConfig {
  /** Transcription prompt text */
  transcriptionPrompt: string;
  /** Evaluation prompt text */
  evaluationPrompt: string;
  /** Transcription schema */
  transcriptionSchema?: import('@/types').SchemaDefinition;
  /** Evaluation schema */
  evaluationSchema?: import('@/types').SchemaDefinition;
  /** Skip transcription and reuse existing */
  skipTranscription?: boolean;
  /** Enable normalization of original transcript */
  normalizeOriginal?: boolean;
  /** Which transcripts to normalize (if enabled) */
  normalizationTarget?: 'original' | 'judge' | 'both';
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert AIEvaluationV2 to legacy AIEvaluation format
 */
function convertToLegacyFormat(evaluation: AIEvaluationV2): AIEvaluation {
  // The V2 format already includes legacy fields for backward compatibility
  return evaluation as unknown as AIEvaluation;
}

/**
 * Compute match percentage from pipeline result
 */
function computeMatchPercentage(result: PipelineResult): string {
  if (result.evaluation?.output.statistics) {
    const stats = result.evaluation.output.statistics;
    return ((stats.matchCount / stats.totalSegments) * 100).toFixed(1);
  }
  
  if (result.evaluation?.output.transcriptComparison) {
    return result.evaluation.output.transcriptComparison.overallMatch.toFixed(1);
  }
  
  return 'N/A';
}

/**
 * Map pipeline step to legacy logger step format
 */
function mapPipelineStepToLoggerStep(step?: PipelineStep): 'transcription' | 'critique' | 'metrics' {
  switch (step) {
    case 'normalization':
    case 'transcription':
      return 'transcription';
    case 'evaluation':
      return 'critique';
    default:
      return 'transcription';
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for running unified evaluations using the new pipeline.
 * 
 * This hook:
 * - Uses the unified EvaluationPipeline for both upload and API flows
 * - Provides detailed progress tracking
 * - Supports per-step model configuration
 * - Handles normalization, transcription, and evaluation steps
 */
export function useUnifiedEvaluation(): UseUnifiedEvaluationReturn {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [progressState, setProgressState] = useState<EvaluationProgressState | null>(null);
  const pipelineRef = useRef<EvaluationPipeline | null>(null);
  
  const appId = useAppStore((state) => state.currentApp);
  const addTask = useTaskQueueStore((state) => state.addTask);
  const setTaskStatus = useTaskQueueStore((state) => state.setTaskStatus);
  const updateTask = useTaskQueueStore((state) => state.updateTask);
  const completeTask = useTaskQueueStore((state) => state.completeTask);
  
  const evaluate = useCallback(async (
    listing: Listing,
    config?: UnifiedEvaluationConfig
  ): Promise<AIEvaluation | null> => {
    // Get settings
    const llm = useSettingsStore.getState().llm;
    const transcription = useSettingsStore.getState().transcription;
    
    // Validate
    if (!llm.apiKey) {
      setError('API key not configured. Go to Settings to add your API key.');
      return null;
    }
    
    if (!listing.audioFile) {
      setError('No audio file available for this listing.');
      return null;
    }
    
    // Determine if this is upload or API flow
    const isApiFlow = listing.sourceType === 'api';
    const useSegments = !isApiFlow && !!listing.transcript?.segments?.some(
      s => s.startSeconds !== undefined || s.endSeconds !== undefined
    );
    
    logEvaluationFlowSelected(listing.id, isApiFlow ? 'api' : 'segment', {
      sourceType: listing.sourceType,
      hasTimeSegments: useSegments,
    });
    
    // Build full evaluation config
    const transcriptionPrompt = config?.transcriptionPrompt ?? llm.transcriptionPrompt;
    const evaluationPrompt = config?.evaluationPrompt ?? llm.evaluationPrompt;
    
    const fullConfig = buildEvaluationConfig({
      sourceType: listing.sourceType === 'api' ? 'api' : 'upload',
      language: transcription.languageHint || 'Hindi',
      sourceScript: 'auto',
      targetScript: transcription.scriptPreference === 'devanagari' ? 'Devanagari' : 'Roman',
      enableNormalization: config?.normalizeOriginal ?? false,
      normalizationTarget: config?.normalizationTarget ?? 'original',
      normalizationModel: llm.stepModels?.normalization || llm.selectedModel,
      preserveCodeSwitching: transcription.preserveCodeSwitching,
      skipTranscription: config?.skipTranscription ?? false,
      reuseTranscriptFrom: config?.skipTranscription ? listing.aiEval?.id : undefined,
      transcriptionModel: llm.stepModels?.transcription || llm.selectedModel,
      transcriptionPrompt,
      transcriptionSchema: config?.transcriptionSchema,
      useSegments,
      evaluationModel: llm.stepModels?.evaluation || llm.selectedModel,
      evaluationPrompt,
      evaluationSchema: config?.evaluationSchema,
    });
    
    // Set up state
    setIsEvaluating(true);
    setError(null);
    setProgress('Initializing...');
    setProgressState({ 
      currentStep: 'transcription',
      stepNumber: 1,
      totalSteps: fullConfig.prerequisites.normalization.enabled ? 3 : 2,
      stepProgress: 0,
      overallProgress: 0,
      message: 'Initializing...',
    });
    
    logEvaluationStart(listing.id, { 
      transcription: transcriptionPrompt, 
      evaluation: evaluationPrompt 
    });
    
    // Create task
    const taskId = addTask({
      listingId: listing.id,
      type: 'ai_eval',
      prompt: transcriptionPrompt,
      inputSource: 'audio',
      stage: 'preparing',
      steps: {
        includeTranscription: !fullConfig.transcription.skip,
        includeNormalization: fullConfig.prerequisites.normalization.enabled,
        includeCritique: true,
      },
      currentStep: 0,
      totalSteps: fullConfig.prerequisites.normalization.enabled ? 3 : 2,
    });
    
    // Create pipeline
    const pipeline = new EvaluationPipeline(fullConfig, listing.id);
    pipelineRef.current = pipeline;
    
    // Register cancellation
    taskCancellationRegistry.register(taskId, () => {
      pipeline.cancel();
    });
    
    try {
      setTaskStatus(taskId, 'processing');
      
      // Set up progress tracking
      pipeline.onProgress((state) => {
        setProgress(state.message);
        setProgressState(state);
        updateTask(taskId, { 
          stage: state.currentStep as import('@/types').EvaluationStage,
          currentStep: state.stepNumber,
          progress: state.overallProgress,
        });
      });
      
      // Execute pipeline
      const result = await pipeline.execute();
      
      if (!result.success) {
        throw new Error(result.error || 'Evaluation failed');
      }
      
      // Build evaluation result
      const evaluation = pipeline.buildEvaluationResult(result);
      
      // Save to database (as AIEvaluation for backward compatibility)
      const legacyEval = convertToLegacyFormat(evaluation);
      await listingsRepository.update(appId, listing.id, { aiEval: legacyEval });
      
      completeTask(taskId, legacyEval);
      
      // Compute match percentage
      const matchPercentage = computeMatchPercentage(result);
      
      logEvaluationComplete(listing.id, {
        segmentCount: result.transcription?.output.segments?.length ?? 0,
        critiqueCount: result.evaluation?.output.segmentCritiques?.length ?? 0,
        skippedTranscription: fullConfig.transcription.skip,
      });
      
      const skipNote = fullConfig.transcription.skip ? ' (reused transcript)' : '';
      notificationService.success(
        `AI evaluation complete${skipNote}. Match: ${matchPercentage}%`
      );
      
      return legacyEval;
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'AI evaluation failed';
      
      // Map pipeline step to legacy logger step
      const loggerStep = mapPipelineStepToLoggerStep(progressState?.currentStep);
      logEvaluationFailed(listing.id, loggerStep, errorMessage);
      
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
      pipelineRef.current = null;
      taskCancellationRegistry.unregister(taskId);
    }
  }, [appId, addTask, setTaskStatus, updateTask, completeTask, progressState]);
  
  const cancel = useCallback(() => {
    pipelineRef.current?.cancel();
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
