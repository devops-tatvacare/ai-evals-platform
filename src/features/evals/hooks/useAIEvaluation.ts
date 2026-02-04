import { useState, useCallback, useRef } from 'react';
import { createEvaluationService, type EvaluationProgress } from '@/services/llm';
import { createNormalizationService, detectTranscriptScript } from '@/services/normalization';
import { useSettingsStore, useTaskQueueStore, useAppStore } from '@/stores';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { logEvaluationStart, logEvaluationComplete, logEvaluationFailed, logCall1Skipped, logNormalizationStart, logNormalizationComplete, logNormalizationSkipped } from '@/services/logger';
import { resolvePrompt, type VariableContext } from '@/services/templates';
import type { AIEvaluation, Listing, EvaluationStage, EvaluationCallNumber, SchemaDefinition } from '@/types';
import { generateId } from '@/utils';
import { taskCancellationRegistry } from '@/services/taskCancellation';

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
    // Branch based on sourceType
    if (listing.sourceType === 'api') {
      return evaluateApiFlow(listing, config);
    }

    // === Upload Flow (existing segment-based evaluation) ===
    
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

    // Determine which steps will be executed
    const includeTranscription = !skipTranscription;
    const includeNormalization = config?.normalizeOriginal ?? false;
    const includeCritique = true; // Always run critique (Call 2)
    
    let totalSteps = 0;
    if (includeTranscription) totalSteps++;
    if (includeNormalization) totalSteps++;
    if (includeCritique) totalSteps++;

    const taskId = addTask({
      listingId: listing.id,
      type: 'ai_eval',
      prompt: transcriptionPrompt,
      inputSource: 'audio',
      stage: 'preparing',
      steps: {
        includeTranscription,
        includeNormalization,
        includeCritique,
      },
      currentStep: 0,
      totalSteps,
    });

    // Register cancel function for this task
    taskCancellationRegistry.register(taskId, () => {
      cancelledRef.current = true;
      if (serviceRef.current) {
        serviceRef.current.cancel();
      }
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
      let currentStepNumber = 0;

      if (skipTranscription) {
        // === SKIP CALL 1: Reuse existing AI transcript ===
        setProgress('Skipping transcription (using existing AI transcript)...');
        setProgressState({ 
          stage: 'transcribing', 
          message: 'Skipping transcription (using existing AI transcript)', 
          callNumber: 1,
          progress: 100 
        });

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
        // === STEP: Transcription ===
        currentStepNumber++;
        updateTask(taskId, { stage: 'transcribing', currentStep: currentStepNumber });

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

      // === STEP: Normalization (if enabled) ===
      let originalForCritique = listing.transcript;
      const normalizeOriginal = config?.normalizeOriginal ?? false;

      if (normalizeOriginal) {
        currentStepNumber++;
        setProgress('Normalizing original transcript...');
        setProgressState({ 
          stage: 'normalizing', 
          message: 'Transliterating original transcript to target script...', 
          progress: 0 
        });
        updateTask(taskId, { stage: 'normalizing', currentStep: currentStepNumber });

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
          
          logNormalizationStart(listing.id, scriptDetection.primaryScript, targetScript);
          
          // Smart skip: Don't normalize if source and target are compatible
          const sourceNormalized = (scriptDetection.primaryScript === 'romanized' || scriptDetection.primaryScript === 'english') 
            ? 'roman' 
            : scriptDetection.primaryScript;
          const targetNormalized = targetScript.toLowerCase();
          
          if (sourceNormalized === targetNormalized || 
              (sourceNormalized === 'roman' && targetNormalized === 'roman') ||
              (sourceNormalized === 'devanagari' && targetNormalized === 'devanagari')) {
            logNormalizationSkipped(listing.id, 'Source and target scripts are the same');
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
            
            console.log('[DEBUG NORM] Normalization data SET in evaluation object:', {
              hasNormalizedOriginal: !!evaluation.normalizedOriginal,
              normalizedSegmentCount: evaluation.normalizedOriginal?.segments?.length,
              metaEnabled: evaluation.normalizationMeta?.enabled,
              metaSourceScript: evaluation.normalizationMeta?.sourceScript,
              metaTargetScript: evaluation.normalizationMeta?.targetScript,
            });
            
            logNormalizationComplete(listing.id, normalizedTranscript.segments.length);
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

      // === STEP: Critique (always runs) ===
      currentStepNumber++;
      updateTask(taskId, { stage: 'critiquing', currentStep: currentStepNumber });

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
      updateTask(taskId, { stage: 'complete', currentStep: totalSteps, progress: 100 });

      console.log('[DEBUG NORM] BEFORE save - evaluation object:', {
        evaluationId: evaluation.id,
        hasNormalizedOriginal: !!evaluation.normalizedOriginal,
        normalizedSegmentCount: evaluation.normalizedOriginal?.segments?.length,
        metaEnabled: evaluation.normalizationMeta?.enabled,
        metaSourceScript: evaluation.normalizationMeta?.sourceScript,
        evaluationKeys: Object.keys(evaluation),
      });

      // Save evaluation to listing
      await listingsRepository.update(appId, listing.id, { aiEval: evaluation });
      
      console.log('[DEBUG NORM] AFTER save - checking what was passed:', {
        updatePayload: { aiEval: evaluation },
        hasNormalizedInPayload: !!(evaluation as any).normalizedOriginal,
      });

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
      // Unregister cancel function
      taskCancellationRegistry.unregister(taskId);
    }
  }, [appId, addTask, setTaskStatus, updateTask, completeTask]);

  const evaluateApiFlow = useCallback(async (
    listing: Listing,
    config?: EvaluationConfig
  ): Promise<AIEvaluation | null> => {
    const llm = useSettingsStore.getState().llm;

    if (!llm.apiKey) {
      setError('API key not configured. Go to Settings to add your API key.');
      return null;
    }

    if (!listing.audioFile) {
      setError('No audio file available for this listing.');
      return null;
    }

    if (!listing.apiResponse) {
      setError('No API response available. Fetch from API first.');
      return null;
    }

    setIsEvaluating(true);
    setError(null);
    setProgress('Initializing...');
    setProgressState({ stage: 'preparing', message: 'Initializing...' });
    cancelledRef.current = false;

    const transcriptionPrompt = config?.prompts?.transcription ?? llm.transcriptionPrompt;
    const evaluationPrompt = config?.prompts?.evaluation ?? llm.evaluationPrompt;

    logEvaluationStart(listing.id, { transcription: transcriptionPrompt, evaluation: evaluationPrompt });

    const taskId = addTask({
      listingId: listing.id,
      type: 'ai_eval',
      prompt: transcriptionPrompt,
      inputSource: 'audio',
      stage: 'preparing',
      steps: {
        includeTranscription: true,
        includeNormalization: false,
        includeCritique: true,
      },
      currentStep: 0,
      totalSteps: 2,
    });

    taskCancellationRegistry.register(taskId, () => {
      cancelledRef.current = true;
      if (serviceRef.current) {
        serviceRef.current.cancel();
      }
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

      // === CALL 1: Judge Transcription + Structured Extraction ===
      setProgress('Step 1/2: Judge transcription...');
      updateTask(taskId, { currentStep: 1 });

      const apiSchemaToUse = config?.schemas?.transcription?.schema;
      if (!apiSchemaToUse) {
        throw new Error('No API response schema configured. Check settings.');
      }

      const call1Result = await service.transcribeForApiFlow(
        storedFile.data,
        listing.audioFile.mimeType,
        transcriptionPrompt,
        apiSchemaToUse,
        handleProgress
      );

      evaluation.judgeOutput = {
        transcript: call1Result.transcript,
        structuredData: call1Result.structuredData,
      };

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // === CALL 2: Comparison & Critique ===
      setProgress('Step 2/2: Comparing outputs...');
      updateTask(taskId, { currentStep: 2 });

      const critiqueSchemaToUse = config?.schemas?.evaluation?.schema;
      if (!critiqueSchemaToUse) {
        throw new Error('No critique schema configured. Check settings.');
      }

      const call2Result = await service.critiqueForApiFlow(
        {
          audioBlob: storedFile.data,
          mimeType: listing.audioFile.mimeType,
          apiResponse: listing.apiResponse,
          judgeOutput: call1Result,
        },
        evaluationPrompt,
        critiqueSchemaToUse,
        handleProgress
      );

      evaluation.apiCritique = call2Result.critique;
      evaluation.status = 'completed';

      await listingsRepository.update(appId, listing.id, { aiEval: evaluation });

      completeTask(taskId, evaluation);

      const accuracy = call2Result.critique.structuredComparison.overallAccuracy;
      const transcriptMatch = call2Result.critique.transcriptComparison.overallMatch;

      logEvaluationComplete(listing.id, {
        segmentCount: 0,
        critiqueCount: call2Result.critique.structuredComparison.fields.length,
        skippedTranscription: false,
      });

      notificationService.success(
        `AI evaluation complete. Transcript: ${transcriptMatch}%, Structured: ${accuracy}%`
      );

      return evaluation;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'AI evaluation failed';

      const failedAt = progressState?.stage === 'transcribing' ? 'transcription' : 'critique';

      evaluation.status = 'failed';
      evaluation.error = errorMessage;
      evaluation.failedAt = failedAt as 'transcription' | 'critique';

      logEvaluationFailed(listing.id, failedAt as 'transcription' | 'critique', errorMessage);

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
      taskCancellationRegistry.unregister(taskId);
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
