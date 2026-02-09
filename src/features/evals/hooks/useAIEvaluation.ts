import { useState, useCallback, useRef } from "react";
import {
  createEvaluationService,
  type EvaluationProgress,
} from "@/services/llm";
import {
  createNormalizationService,
  detectTranscriptScript,
} from "@/services/normalization";
import { useSettingsStore, useTaskQueueStore, useAppStore } from "@/stores";
import { listingsRepository, filesRepository } from "@/services/storage";
import { notificationService } from "@/services/notifications";
import {
  logEvaluationStart,
  logEvaluationComplete,
  logEvaluationFailed,
  logCall1Skipped,
  logNormalizationStart,
  logNormalizationComplete,
  logNormalizationSkipped,
  logEvaluationFlowSelected,
} from "@/services/logger";
import { resolvePrompt, type VariableContext } from "@/services/templates";
import type {
  AIEvaluation,
  Listing,
  EvaluationStage,
  EvaluationCallNumber,
  SchemaDefinition,
  TranscriptData,
} from "@/types";
import { generateId } from "@/utils";
import { taskCancellationRegistry } from "@/services/taskCancellation";

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
  models?: {
    transcription?: string;
    evaluation?: string;
  };
  /** Skip Call 1 (transcription) and reuse existing AI transcript */
  skipTranscription?: boolean;
  /** Normalize original transcript to target script before evaluation */
  normalizeOriginal?: boolean;
  /** Use time-segmented evaluation (upload flow with segments) vs regular evaluation */
  useSegments?: boolean;
  /** New prerequisites config from 3-step wizard */
  prerequisites?: {
    language: string;
    sourceScript: string;
    targetScript: string;
    normalizationEnabled: boolean;
    normalizationTarget: import("@/types").NormalizationTarget;
    preserveCodeSwitching: boolean;
    normalizationModel?: string;
  };
}

interface UseAIEvaluationReturn {
  isEvaluating: boolean;
  error: string | null;
  progress: string;
  progressState: EvaluationProgressState | null;
  evaluate: (
    listing: Listing,
    config?: EvaluationConfig,
  ) => Promise<AIEvaluation | null>;
  cancel: () => void;
}

export function useAIEvaluation(): UseAIEvaluationReturn {
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [progressState, setProgressState] =
    useState<EvaluationProgressState | null>(null);
  const serviceRef = useRef<{
    transcription: ReturnType<typeof createEvaluationService> | null;
    evaluation: ReturnType<typeof createEvaluationService> | null;
  }>({
    transcription: null,
    evaluation: null,
  });
  const cancelledRef = useRef(false);

  const appId = useAppStore((state) => state.currentApp);
  const addTask = useTaskQueueStore((state) => state.addTask);
  const setTaskStatus = useTaskQueueStore((state) => state.setTaskStatus);
  const updateTask = useTaskQueueStore((state) => state.updateTask);
  const completeTask = useTaskQueueStore((state) => state.completeTask);

  const evaluate = useCallback(
    async (
      listing: Listing,
      config?: EvaluationConfig,
    ): Promise<AIEvaluation | null> => {
      // === Unified Flow: Detect available inputs ===
      const hasApiResponse =
        listing.sourceType === "api" && !!listing.apiResponse;
      const hasUploadTranscript =
        listing.sourceType === "upload" && !!listing.transcript;

      // Log flow selection based on detected inputs
      if (hasApiResponse) {
        logEvaluationFlowSelected(listing.id, "api", {
          sourceType: listing.sourceType,
          hasApiResponse: true,
        });
      } else if (hasUploadTranscript) {
        logEvaluationFlowSelected(listing.id, "segment", {
          sourceType: listing.sourceType,
          hasTimeSegments: listing.transcript?.segments?.some(
            (s) => s.startSeconds !== undefined && s.endSeconds !== undefined,
          ),
        });
      }

      // Get fresh values from store each time evaluate is called
      const llm = useSettingsStore.getState().llm;

      const transcriptionPrompt =
        config?.prompts?.transcription ?? llm.transcriptionPrompt;
      const evaluationPrompt =
        config?.prompts?.evaluation ?? llm.evaluationPrompt;
      const skipTranscription = config?.skipTranscription ?? false;

      // Use models from config, fallback to global settings
      const transcriptionModel =
        config?.models?.transcription || llm.selectedModel;
      const evaluationModel = config?.models?.evaluation || llm.selectedModel;

      if (!llm.apiKey) {
        setError("API key not configured. Go to Settings to add your API key.");
        return null;
      }

      if (!listing.audioFile) {
        setError("No audio file available for this listing.");
        return null;
      }

      // Validation based on flow type
      if (hasUploadTranscript) {
        if (!listing.transcript) {
          setError("No original transcript available for comparison.");
          return null;
        }
        // Validate skipTranscription - must have existing AI transcript
        if (skipTranscription && !listing.aiEval?.llmTranscript) {
          setError(
            "Cannot skip transcription: no existing AI transcript available.",
          );
          return null;
        }
      } else if (hasApiResponse) {
        if (!listing.apiResponse) {
          setError("No API response available. Fetch from API first.");
          return null;
        }
      } else {
        setError("No valid input data available for evaluation.");
        return null;
      }

      setIsEvaluating(true);
      setError(null);
      setProgress("Initializing...");
      setProgressState({ stage: "preparing", message: "Initializing..." });
      cancelledRef.current = false;

      logEvaluationStart(listing.id, {
        transcription: transcriptionPrompt,
        evaluation: evaluationPrompt,
      });

      // Determine which steps will be executed (varies by flow)
      const includeTranscription = hasApiResponse ? true : !skipTranscription;
      const includeNormalization =
        hasUploadTranscript && (config?.normalizeOriginal ?? false);
      const includeCritique = true; // Always run critique (Call 2)
      
      let totalSteps = 0;
      if (includeTranscription) totalSteps++;
      if (includeNormalization) totalSteps++;
      if (includeCritique) totalSteps++;

      const taskId = addTask({
        listingId: listing.id,
        type: "ai_eval",
        prompt: transcriptionPrompt,
        inputSource: "audio",
        stage: "preparing",
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
        if (serviceRef.current.transcription) {
          serviceRef.current.transcription.cancel();
        }
        if (serviceRef.current.evaluation) {
          serviceRef.current.evaluation.cancel();
        }
      });

      const evaluation: AIEvaluation = {
        id: generateId(),
        createdAt: new Date(),
        model: transcriptionModel, // Use transcription model as the primary model for backward compat
        status: "processing",
        prompts: {
          transcription: transcriptionPrompt,
          evaluation: evaluationPrompt,
        },
        schemas: config?.schemas,
      };

      try {
        setTaskStatus(taskId, "processing");

        // Load audio file
        setProgress("Loading audio file...");
        setProgressState({
          stage: "preparing",
          message: "Loading audio file...",
          progress: 5,
        });

        const storedFile = await filesRepository.getById(listing.audioFile.id);
        if (!storedFile) {
          throw new Error("Audio file not found in storage");
        }

        if (cancelledRef.current) {
          setTaskStatus(taskId, "cancelled");
          return null;
        }

        // Create evaluation services (one for transcription, one for evaluation)
        const transcriptionService = createEvaluationService(
          llm.apiKey,
          transcriptionModel,
        );
        const evaluationService = createEvaluationService(
          llm.apiKey,
          evaluationModel,
        );
        serviceRef.current = {
          transcription: transcriptionService,
          evaluation: evaluationService,
        };

        const handleProgress = (p: EvaluationProgress) => {
          setProgress(p.message);
          setProgressState({
            stage: p.stage,
            message: p.message,
            callNumber: p.callNumber,
            progress: p.progress,
          });
          updateTask(taskId, {
            stage: p.stage,
            callNumber: p.callNumber,
            progress: p.progress,
          });
        };

        // Data for Call 2 (varies by flow)
        let llmTranscriptForCritique: TranscriptData | undefined =
          listing.aiEval?.llmTranscript;
        let judgeOutputForCritique:
          | { transcript: string; structuredData: Record<string, unknown> }
          | undefined;
        let currentStepNumber = 0;

        if (skipTranscription && hasUploadTranscript) {
          // === SKIP CALL 1: Reuse existing AI transcript (upload flow only) ===
          setProgress(
            "Skipping transcription (using existing AI transcript)...",
          );
          setProgressState({
            stage: "transcribing",
            message: "Skipping transcription (using existing AI transcript)",
            callNumber: 1,
            progress: 100,
          });

          // Log the skip event
          logCall1Skipped(listing.id, {
            existingTranscriptSegments:
              llmTranscriptForCritique!.segments.length,
            existingModel: listing.aiEval?.model || "unknown",
            existingCreatedAt: listing.aiEval?.createdAt,
          });

          // Preserve the existing transcript in the new evaluation
          evaluation.llmTranscript = llmTranscriptForCritique;
          // Also preserve the original transcription prompt/schema that created it
          if (listing.aiEval?.prompts?.transcription) {
            evaluation.prompts!.transcription =
              listing.aiEval.prompts.transcription;
          }
          if (listing.aiEval?.schemas?.transcription) {
            evaluation.schemas = {
              ...evaluation.schemas,
              transcription: listing.aiEval.schemas.transcription,
            };
          }
        } else if (includeTranscription) {
          // === STEP: Transcription (both upload and API flows) ===
          currentStepNumber++;
          updateTask(taskId, {
            stage: "transcribing",
            currentStep: currentStepNumber,
          });

          // Resolve template variables for Call 1
          const transcriptionContext: VariableContext = {
            listing,
            audioBlob: storedFile.data,
            prerequisites: config?.prerequisites,
          };
          const resolvedTranscription = resolvePrompt(
            transcriptionPrompt,
            transcriptionContext,
          );

          // Warn if there are unresolved variables (excluding {{audio}} which is handled as file)
          const unresolvedVars =
            resolvedTranscription.unresolvedVariables.filter(
              (v) => v !== "{{audio}}",
            );
          if (unresolvedVars.length > 0) {
            console.warn(
              "Unresolved variables in transcription prompt:",
              unresolvedVars,
            );
          }

          if (hasApiResponse) {
            // === API Flow: Judge transcription + structured extraction ===
            const apiSchemaToUse = config?.schemas?.transcription?.schema;
            if (!apiSchemaToUse) {
              throw new Error(
                "No API response schema configured for transcription.",
              );
            }

            const call1Result = await transcriptionService.transcribeForApiFlow(
              storedFile.data,
              listing.audioFile.mimeType,
              resolvedTranscription.prompt,
              apiSchemaToUse,
              handleProgress,
            );

            if (cancelledRef.current) {
              setTaskStatus(taskId, "cancelled");
              return null;
            }

            evaluation.judgeOutput = {
              transcript: call1Result.transcript,
              structuredData: call1Result.structuredData,
            };
            judgeOutputForCritique = {
              transcript: call1Result.transcript,
              structuredData: call1Result.structuredData as unknown as Record<
                string,
                unknown
              >,
            };
          } else {
            // === Upload Flow: Segment-based transcription ===
            const transcriptionResult = await transcriptionService.transcribe(
              storedFile.data,
              listing.audioFile.mimeType,
              resolvedTranscription.prompt,
              config?.schemas?.transcription?.schema,
              handleProgress,
            );

            if (cancelledRef.current) {
              setTaskStatus(taskId, "cancelled");
              return null;
            }

            evaluation.llmTranscript = transcriptionResult.transcript;
            llmTranscriptForCritique = transcriptionResult.transcript;
          }
        }

        if (cancelledRef.current) {
          setTaskStatus(taskId, "cancelled");
          return null;
        }

        // === STEP: Normalization (if enabled) ===
        let originalForCritique: TranscriptData = listing.transcript!;
        const normalizeOriginal = config?.normalizeOriginal ?? false;
        
        if (normalizeOriginal) {
          currentStepNumber++;
          setProgress("Normalizing original transcript...");
          setProgressState({
            stage: "normalizing",
            message: "Transliterating original transcript to target script...",
            progress: 0,
          });
          updateTask(taskId, {
            stage: "normalizing",
            currentStep: currentStepNumber,
          });

          try {
            // Detect source script
            if (!listing.transcript) {
              throw new Error("No transcript available for normalization");
            }
            const scriptDetection = detectTranscriptScript(listing.transcript);

            // Determine target script from prerequisites (defaults: roman)
            const targetScript = config?.prerequisites?.targetScript || "roman";
            const targetScriptCapitalized = targetScript.charAt(0).toUpperCase() + targetScript.slice(1);

            logNormalizationStart(
              listing.id,
              scriptDetection.primaryScript,
              targetScriptCapitalized,
            );

            // Smart skip: Don't normalize if source and target are compatible
            const sourceNormalized =
              scriptDetection.primaryScript === "romanized" ||
              scriptDetection.primaryScript === "english"
                ? "roman"
                : scriptDetection.primaryScript;
            const targetNormalized = targetScript.toLowerCase();

            if (
              sourceNormalized === targetNormalized ||
              (sourceNormalized === "roman" && targetNormalized === "roman") ||
              (sourceNormalized === "devanagari" &&
                targetNormalized === "devanagari")
            ) {
              logNormalizationSkipped(
                listing.id,
                "Source and target scripts are the same",
              );
              originalForCritique = listing.transcript;
              evaluation.normalizationMeta = {
                enabled: false,
                sourceScript: scriptDetection.primaryScript,
                targetScript: targetScriptCapitalized,
                normalizedAt: new Date(),
              };
            } else {
              // Create normalization service with optional model
              const normalizationModel = config?.prerequisites?.normalizationModel;
              const normService = createNormalizationService(normalizationModel);

              // Normalize (listing.transcript is validated earlier)
              if (!listing.transcript) {
                throw new Error("No transcript available for normalization");
              }
              const normalizedTranscript = await normService.normalize(
                listing.transcript,
                targetScriptCapitalized,
                scriptDetection.primaryScript,
                normalizationModel,
              );

              originalForCritique = normalizedTranscript;

              // Store normalization metadata
              evaluation.normalizedOriginal = normalizedTranscript;
              evaluation.normalizationMeta = {
                enabled: true,
                sourceScript: scriptDetection.primaryScript,
                targetScript: targetScriptCapitalized,
                normalizedAt: new Date(),
              };

              logNormalizationComplete(
                listing.id,
                normalizedTranscript.segments.length,
              );
            }
          } catch (error) {
            // Non-critical: continue with original if normalization fails
            if (listing.transcript) {
              originalForCritique = listing.transcript;
            }
            evaluation.normalizationMeta = {
              enabled: false,
              sourceScript: "unknown",
              targetScript: "",
              normalizedAt: new Date(),
            };
          }
        }

        if (cancelledRef.current) {
          setTaskStatus(taskId, "cancelled");
          return null;
        }

        // === STEP: Critique (always runs, varies by flow) ===
        currentStepNumber++;
        updateTask(taskId, {
          stage: "critiquing",
          currentStep: currentStepNumber,
        });

        if (hasApiResponse && judgeOutputForCritique) {
          // === API Flow: Compare API output vs Judge output ===

          // Use API-specific critique schema
          let critiqueSchemaToUse = config?.schemas?.evaluation?.schema;

          // If no evaluation schema configured, or if it's the segment-based one,
          // fall back to the default API critique schema
          if (
            !critiqueSchemaToUse ||
            config?.schemas?.evaluation?.name?.includes("Standard Evaluation")
          ) {
            const { DEFAULT_API_CRITIQUE_SCHEMA } = await import("@/constants");
            critiqueSchemaToUse = DEFAULT_API_CRITIQUE_SCHEMA.schema;
          }

          const call2Result = await evaluationService.critiqueForApiFlow(
            {
              audioBlob: storedFile.data,
              mimeType: listing.audioFile.mimeType,
              apiResponse: listing.apiResponse!,
              judgeOutput: {
                transcript: judgeOutputForCritique.transcript,
                structuredData:
                  judgeOutputForCritique.structuredData as unknown as import("@/types").GeminiApiRx, // Type flexibility for different schema shapes
              },
            },
            evaluationPrompt,
            critiqueSchemaToUse,
            handleProgress,
          );

          if (cancelledRef.current) {
            setTaskStatus(taskId, "cancelled");
            return null;
          }

          evaluation.apiCritique = call2Result.critique;

          // Extract metrics for notification
          const accuracy =
            call2Result.critique.structuredComparison?.overallAccuracy ?? 0;
          const transcriptMatch =
            call2Result.critique.transcriptComparison?.overallMatch ?? 0;

          evaluation.status = "completed";
          setProgressState({
            stage: "complete",
            message: "Evaluation complete",
            progress: 100,
          });
          updateTask(taskId, {
            stage: "complete",
            currentStep: totalSteps,
            progress: 100,
          });

          await listingsRepository.update(appId, listing.id, {
            aiEval: evaluation,
          });
          completeTask(taskId, evaluation);

          const critiqueCount =
            call2Result.critique.structuredComparison?.fields?.length ?? 0;
          logEvaluationComplete(listing.id, {
            segmentCount: 0,
            critiqueCount,
            skippedTranscription: false,
          });

          notificationService.success(
            `AI evaluation complete. Transcript: ${transcriptMatch}%, Structured: ${accuracy}%`,
          );

          return evaluation;
        } else if (llmTranscriptForCritique) {
          // === Upload Flow: Segment-based critique ===
          const critiqueResult = await evaluationService.critique(
            {
              audioBlob: storedFile.data,
              mimeType: listing.audioFile.mimeType,
              originalTranscript: originalForCritique,
              llmTranscript: llmTranscriptForCritique, // Type narrowed by if condition
              prerequisites: config?.prerequisites,
            },
            evaluationPrompt,
            config?.schemas?.evaluation?.schema,
            handleProgress,
          );

          if (cancelledRef.current) {
            setTaskStatus(taskId, "cancelled");
            return null;
          }

          evaluation.critique = critiqueResult.critique;

          // === Complete ===
          evaluation.status = "completed";
          setProgressState({
            stage: "complete",
            message: "Evaluation complete",
            progress: 100,
          });
          updateTask(taskId, {
            stage: "complete",
            currentStep: totalSteps,
            progress: 100,
          });

          // Save evaluation to listing
          await listingsRepository.update(appId, listing.id, {
            aiEval: evaluation,
          });

          completeTask(taskId, evaluation);

          // Compute match percentage from critique statistics
          const stats = critiqueResult.critique.statistics;
          const matchPercentage = stats
            ? ((stats.matchCount / stats.totalSegments) * 100).toFixed(1)
            : "N/A";

          logEvaluationComplete(listing.id, {
            segmentCount: llmTranscriptForCritique!.segments.length,
            critiqueCount: critiqueResult.critique.segments.length,
            skippedTranscription: skipTranscription,
          });

          const skipNote = skipTranscription ? " (reused transcript)" : "";
          notificationService.success(
            `AI evaluation complete${skipNote}. Match: ${matchPercentage}%`,
          );

          return evaluation;
        } else {
          throw new Error(
            "No valid transcription data available for critique step",
          );
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "AI evaluation failed";

        // Determine which call failed
        const failedAt =
          progressState?.stage === "transcribing"
            ? "transcription"
            : "critique";

        evaluation.status = "failed";
        evaluation.error = errorMessage;
        evaluation.failedAt = failedAt as "transcription" | "critique";

        logEvaluationFailed(
          listing.id,
          failedAt as "transcription" | "critique",
          errorMessage,
        );

        // Save the failed evaluation (may have partial results)
        await listingsRepository.update(appId, listing.id, {
          aiEval: evaluation,
        });

        setError(errorMessage);
        setProgressState({ stage: "failed", message: errorMessage });
        setTaskStatus(taskId, "failed", errorMessage);
        notificationService.error(errorMessage, "AI Evaluation failed");
        return evaluation;
      } finally {
        setIsEvaluating(false);
        setProgress("");
        serviceRef.current = { transcription: null, evaluation: null };
        // Unregister cancel function
        taskCancellationRegistry.unregister(taskId);
      }
    },
    [
      appId,
      addTask,
      setTaskStatus,
      updateTask,
      completeTask,
      progressState?.stage,
    ],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (serviceRef.current.transcription) {
      serviceRef.current.transcription.cancel();
    }
    if (serviceRef.current.evaluation) {
      serviceRef.current.evaluation.cancel();
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
