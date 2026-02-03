import { useState, useCallback, useRef } from 'react';
import { createEvaluationService, type EvaluationProgress } from '@/services/llm';
import { createNormalizationService, detectTranscriptScript } from '@/services/normalization';
import { useSettingsStore, useTaskQueueStore, useAppStore } from '@/stores';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { logEvaluationStart, logEvaluationComplete, logEvaluationFailed, logCall1Skipped } from '@/services/logger';
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
  /** Skip Call 1 (transcription) and reuse existing AI transcript */
  skipTranscription?: boolean;
  /** Normalize original transcript to target script before evaluation */
  normalizeOriginal?: boolean;
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

  const appId = useAppStore((state) => state.currentApp);
  const addTask = useTaskQueueStore((state) => state.addTask);
  const setTaskStatus = useTaskQueueStore((state) => state.setTaskStatus);
  const updateTask = useTaskQueueStore((state) => state.updateTask);
  const completeTask = useTaskQueueStore((state) => state.completeTask);

  const evaluate = useCallback(async (
    listing: Listing,
    config?: EvaluationConfig
  ): Promise<AIEvaluation | null> => {
    // Get fresh values from store each time evaluate is called
    const llm = useSettingsStore.getState().llm;
    const transcription = useSettingsStore.getState().transcription;
    
    const transcriptionPrompt = config?.prompts?.transcription ?? llm.transcriptionPrompt;
    const evaluationPrompt = config?.prompts?.evaluation ?? llm.evaluationPrompt;
    const skipTranscription = config?.skipTranscription ?? false;

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

    // Validate skipTranscription - must have existing AI transcript
    if (skipTranscription && !listing.aiEval?.llmTranscript) {
      setError('Cannot skip transcription: no existing AI transcript available.');
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

      // Determine the AI transcript to use for Call 2
      let llmTranscriptForCritique = listing.aiEval?.llmTranscript;

      if (skipTranscription) {
        // === SKIP CALL 1: Reuse existing AI transcript ===
        setProgress('Skipping transcription (using existing AI transcript)...');
        setProgressState({ 
          stage: 'transcribing', 
          message: 'Skipping transcription (using existing AI transcript)', 
          callNumber: 1,
          progress: 40 
        });
        updateTask(taskId, { stage: 'transcribing', callNumber: 1, progress: 40 });

        // Log the skip event
        logCall1Skipped(listing.id, {
          existingTranscriptSegments: llmTranscriptForCritique!.segments.length,
          existingModel: listing.aiEval?.model || 'unknown',
          existingCreatedAt: listing.aiEval?.createdAt,
        });

        // Preserve the existing transcript in the new evaluation
        evaluation.llmTranscript = llmTranscriptForCritique;
        // Also preserve the original transcription prompt/schema that created it
        if (listing.aiEval?.prompts?.transcription) {
          evaluation.prompts!.transcription = listing.aiEval.prompts.transcription;
        }
        if (listing.aiEval?.schemas?.transcription) {
          evaluation.schemas = {
            ...evaluation.schemas,
            transcription: listing.aiEval.schemas.transcription,
          };
        }
      } else {
        // === CALL 1: Transcription ===
        updateTask(taskId, { stage: 'transcribing', callNumber: 1 });

        // Resolve template variables ({{time_windows}}, {{segment_count}}, etc.) for Call 1
        const transcriptionContext: VariableContext = {
          listing,
          audioBlob: storedFile.data,
          transcriptionPreferences: transcription,
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
        llmTranscriptForCritique = transcriptionResult.transcript;
      }

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // === NORMALIZATION: Before Call 2 ===
      let originalForCritique = listing.transcript;
      const normalizeOriginal = config?.normalizeOriginal ?? false;

      if (normalizeOriginal) {
        setProgress('Normalizing original transcript...');
        setProgressState({ 
          stage: 'normalizing', 
          message: 'Transliterating original transcript to target script...', 
          progress: 45 
        });
        updateTask(taskId, { stage: 'normalizing' });

        try {
          // Detect source script
          const scriptDetection = detectTranscriptScript(listing.transcript);
          
          // Determine target script from settings
          let targetScript = 'Roman'; // default
          if (transcription.scriptPreference === 'devanagari') {
            targetScript = 'Devanagari';
          } else if (transcription.scriptPreference === 'romanized') {
            targetScript = 'Roman';
          } else {
            // 'auto' or 'original' - use languageHint to infer, fallback to Roman
            const languageHint = transcription.languageHint?.toLowerCase() || '';
            if (languageHint.includes('hindi') && !languageHint.includes('hinglish')) {
              targetScript = 'Devanagari'; // Pure Hindi → Devanagari
            } else {
              targetScript = 'Roman'; // Hinglish, English, or unknown → Roman
            }
          }
          
          console.log('[Normalization] Source script detected:', scriptDetection.primaryScript);
          console.log('[Normalization] Target script:', targetScript);
          
          // Smart skip: Don't normalize if source and target are compatible
          const sourceNormalized = (scriptDetection.primaryScript === 'romanized' || scriptDetection.primaryScript === 'english') 
            ? 'roman' 
            : scriptDetection.primaryScript;
          const targetNormalized = targetScript.toLowerCase();
          
          if (sourceNormalized === targetNormalized || 
              (sourceNormalized === 'roman' && targetNormalized === 'roman') ||
              (sourceNormalized === 'devanagari' && targetNormalized === 'devanagari')) {
            console.log('[Normalization] Skipping - source and target scripts are the same');
            originalForCritique = listing.transcript;
            evaluation.normalizationMeta = {
              enabled: false,
              sourceScript: scriptDetection.primaryScript,
              targetScript,
              normalizedAt: new Date(),
            };
          } else {
            // Create normalization service
            const normService = createNormalizationService(llm.apiKey, llm.selectedModel);
            
            // Normalize
            const normalizedTranscript = await normService.normalize(
              listing.transcript,
              targetScript,
              scriptDetection.primaryScript
            );
            
            originalForCritique = normalizedTranscript;
            
            // Store normalization metadata
            evaluation.normalizedOriginal = normalizedTranscript;
            evaluation.normalizationMeta = {
              enabled: true,
              sourceScript: scriptDetection.primaryScript,
              targetScript,
              normalizedAt: new Date(),
            };
            
            console.log('[Normalization] Successfully normalized', normalizedTranscript.segments.length, 'segments');
          }
        } catch (error) {
          console.error('[Normalization] Failed:', error);
          // Non-critical: continue with original if normalization fails
          originalForCritique = listing.transcript;
          evaluation.normalizationMeta = {
            enabled: false,
            sourceScript: 'unknown',
            targetScript: '',
            normalizedAt: new Date(),
          };
        }
      }

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // === CALL 2: Critique ===
      updateTask(taskId, { stage: 'critiquing', callNumber: 2 });

      const critiqueResult = await service.critique(
        {
          audioBlob: storedFile.data,
          mimeType: listing.audioFile.mimeType,
          originalTranscript: originalForCritique,
          llmTranscript: llmTranscriptForCritique!,
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
      await listingsRepository.update(appId, listing.id, { aiEval: evaluation });

      completeTask(taskId, evaluation);
      
      // Compute match percentage from critique statistics
      const stats = critiqueResult.critique.statistics;
      const matchPercentage = stats 
        ? ((stats.matchCount / stats.totalSegments) * 100).toFixed(1)
        : 'N/A';

      logEvaluationComplete(listing.id, {
        segmentCount: llmTranscriptForCritique!.segments.length,
        critiqueCount: critiqueResult.critique.segments.length,
        skippedTranscription: skipTranscription,
      });

      const skipNote = skipTranscription ? ' (reused transcript)' : '';
      notificationService.success(
        `AI evaluation complete${skipNote}. Match: ${matchPercentage}%`
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
      await listingsRepository.update(appId, listing.id, { aiEval: evaluation });

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
  }, [appId, addTask, setTaskStatus, updateTask, completeTask]);

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
