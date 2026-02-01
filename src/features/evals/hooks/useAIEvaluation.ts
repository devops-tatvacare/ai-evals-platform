import { useState, useCallback, useRef } from 'react';
import { createEvaluationService, type EvaluationProgress } from '@/services/llm';
import { useSettingsStore, useTaskQueueStore } from '@/stores';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { logEvaluationStart, logEvaluationComplete, logEvaluationFailed } from '@/services/logger';
import { resolvePrompt, type VariableContext } from '@/services/templates';
import type { AIEvaluation, Listing, EvaluationStage, EvaluationCallNumber, SchemaDefinition } from '@/types';
import { generateId } from '@/utils';

export interface EvaluationProgressState {
  stage: EvaluationStage;
  message: string;
  callNumber?: EvaluationCallNumber;
  progress?: number;
}

export interface EvaluationConfig {
  prompts: {
    transcription: string;
    evaluation: string;
  };
  schemas?: {
    transcription?: SchemaDefinition;
    evaluation?: SchemaDefinition;
  };
}

interface UseAIEvaluationReturn {
  isEvaluating: boolean;
  error: string | null;
  progress: string;
  progressState: EvaluationProgressState | null;
  evaluate: (listing: Listing, config?: EvaluationConfig) => Promise<AIEvaluation | null>;
  cancel: () => void;
}

export function useAIEvaluation(): UseAIEvaluationReturn {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [progressState, setProgressState] = useState<EvaluationProgressState | null>(null);
  const serviceRef = useRef<ReturnType<typeof createEvaluationService> | null>(null);
  const cancelledRef = useRef(false);

  const { llm } = useSettingsStore();
  const { addTask, setTaskStatus, updateTask, completeTask } = useTaskQueueStore();

  const evaluate = useCallback(async (
    listing: Listing,
    config?: EvaluationConfig
  ): Promise<AIEvaluation | null> => {
    const transcriptionPrompt = config?.prompts?.transcription ?? llm.transcriptionPrompt;
    const evaluationPrompt = config?.prompts?.evaluation ?? llm.evaluationPrompt;

    if (!llm.apiKey) {
      setError('API key not configured. Go to Settings to add your API key.');
      return null;
    }

    if (!listing.audioFile) {
      setError('No audio file available for this listing.');
      return null;
    }

    if (!listing.transcript) {
      setError('No original transcript available for comparison.');
      return null;
    }

    setIsEvaluating(true);
    setError(null);
    setProgress('Initializing...');
    setProgressState({ stage: 'preparing', message: 'Initializing...' });
    cancelledRef.current = false;

    logEvaluationStart(listing.id, { transcription: transcriptionPrompt, evaluation: evaluationPrompt });

    const taskId = addTask({
      listingId: listing.id,
      type: 'ai_eval',
      prompt: transcriptionPrompt,
      inputSource: 'audio',
      stage: 'preparing',
    });

    const evaluation: AIEvaluation = {
      id: generateId(),
      createdAt: new Date(),
      model: llm.selectedModel,
      status: 'processing',
      prompts: {
        transcription: transcriptionPrompt,
        evaluation: evaluationPrompt,
      },
      schemas: config?.schemas,
    };

    try {
      setTaskStatus(taskId, 'processing');
      
      // Load audio file
      setProgress('Loading audio file...');
      setProgressState({ stage: 'preparing', message: 'Loading audio file...', progress: 5 });

      const storedFile = await filesRepository.getById(listing.audioFile.id);
      if (!storedFile) {
        throw new Error('Audio file not found in storage');
      }

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // Create evaluation service
      const service = createEvaluationService(llm.apiKey, llm.selectedModel);
      serviceRef.current = service;

      // === CALL 1: Transcription ===
      updateTask(taskId, { stage: 'transcribing', callNumber: 1 });
      
      const handleProgress = (p: EvaluationProgress) => {
        setProgress(p.message);
        setProgressState({
          stage: p.stage,
          message: p.message,
          callNumber: p.callNumber,
          progress: p.progress,
        });
        updateTask(taskId, { stage: p.stage, callNumber: p.callNumber, progress: p.progress });
      };

      // Resolve template variables ({{time_windows}}, {{segment_count}}, etc.) for Call 1
      const transcriptionContext: VariableContext = {
        listing,
        audioBlob: storedFile.data,
      };
      const resolvedTranscription = resolvePrompt(transcriptionPrompt, transcriptionContext);
      
      // Warn if there are unresolved variables (excluding {{audio}} which is handled as file)
      const unresolvedVars = resolvedTranscription.unresolvedVariables.filter(v => v !== '{{audio}}');
      if (unresolvedVars.length > 0) {
        console.warn('Unresolved variables in transcription prompt:', unresolvedVars);
      }

      const transcriptionResult = await service.transcribe(
        storedFile.data,
        listing.audioFile.mimeType,
        resolvedTranscription.prompt,
        config?.schemas?.transcription?.schema,
        handleProgress
      );

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      evaluation.llmTranscript = transcriptionResult.transcript;

      // === CALL 2: Critique ===
      updateTask(taskId, { stage: 'critiquing', callNumber: 2 });

      const critiqueResult = await service.critique(
        {
          audioBlob: storedFile.data,
          mimeType: listing.audioFile.mimeType,
          originalTranscript: listing.transcript,
          llmTranscript: transcriptionResult.transcript,
        },
        evaluationPrompt,
        config?.schemas?.evaluation?.schema,
        handleProgress
      );

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      evaluation.critique = critiqueResult.critique;

      // === Complete ===
      evaluation.status = 'completed';
      setProgressState({ stage: 'complete', message: 'Evaluation complete', progress: 100 });

      // Save evaluation to listing
      await listingsRepository.update(listing.id, { aiEval: evaluation });

      completeTask(taskId, evaluation);
      
      // Compute match percentage from critique statistics
      const stats = critiqueResult.critique.statistics;
      const matchPercentage = stats 
        ? ((stats.matchCount / stats.totalSegments) * 100).toFixed(1)
        : 'N/A';

      logEvaluationComplete(listing.id, {
        segmentCount: transcriptionResult.transcript.segments.length,
        critiqueCount: critiqueResult.critique.segments.length,
      });

      notificationService.success(
        `AI evaluation complete. Match: ${matchPercentage}%`
      );

      return evaluation;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'AI evaluation failed';
      
      // Determine which call failed
      const failedAt = progressState?.stage === 'transcribing' ? 'transcription' : 'critique';
      
      evaluation.status = 'failed';
      evaluation.error = errorMessage;
      evaluation.failedAt = failedAt as 'transcription' | 'critique';

      logEvaluationFailed(listing.id, failedAt as 'transcription' | 'critique', errorMessage);

      // Save the failed evaluation (may have partial results)
      await listingsRepository.update(listing.id, { aiEval: evaluation });

      setError(errorMessage);
      setProgressState({ stage: 'failed', message: errorMessage });
      setTaskStatus(taskId, 'failed', errorMessage);
      notificationService.error(errorMessage, 'AI Evaluation failed');
      return evaluation;
    } finally {
      setIsEvaluating(false);
      setProgress('');
      serviceRef.current = null;
    }
  }, [llm.apiKey, llm.selectedModel, llm.transcriptionPrompt, llm.evaluationPrompt, addTask, setTaskStatus, updateTask, completeTask, progressState?.stage]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (serviceRef.current) {
      serviceRef.current.cancel();
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
