import { useState, useCallback, useRef } from "react";
import { useSettingsStore, useTaskQueueStore, useAppStore } from "@/stores";
import { listingsRepository } from "@/services/storage";
import { notificationService } from "@/services/notifications";
import {
  logEvaluationStart,
  logEvaluationComplete,
  logEvaluationFailed,
  logEvaluationFlowSelected,
} from "@/services/logger";
import { submitAndPollJob, cancelJob } from "@/services/api/jobPolling";
import type {
  AIEvaluation,
  Listing,
  EvaluationStage,
  EvaluationCallNumber,
  SchemaDefinition,
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

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

      // Log flow selection
      if (hasApiResponse) {
        logEvaluationFlowSelected(listing.id, "api", {
          sourceType: listing.sourceType,
          hasApiResponse: true,
        });
      } else if (hasUploadTranscript) {
        logEvaluationFlowSelected(listing.id, "segment", {
          sourceType: listing.sourceType,
        });
      }

      // Get fresh values from store
      const llm = useSettingsStore.getState().llm;

      const transcriptionPrompt =
        config?.prompts?.transcription ?? llm.transcriptionPrompt;
      const evaluationPrompt =
        config?.prompts?.evaluation ?? llm.evaluationPrompt;
      const skipTranscription = config?.skipTranscription ?? false;
      const transcriptionModel =
        config?.models?.transcription || llm.selectedModel;
      const evaluationModel = config?.models?.evaluation || llm.selectedModel;

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
      setProgress("Submitting evaluation job...");
      setProgressState({ stage: "preparing", message: "Submitting job..." });

      logEvaluationStart(listing.id, {
        transcription: transcriptionPrompt,
        evaluation: evaluationPrompt,
      });

      // Determine steps for task queue
      const includeTranscription = hasApiResponse ? true : !skipTranscription;
      const includeNormalization =
        hasUploadTranscript && (config?.normalizeOriginal ?? false);

      let totalSteps = 0;
      if (includeTranscription) totalSteps++;
      if (includeNormalization) totalSteps++;
      totalSteps++; // critique always runs

      const taskId = addTask({
        listingId: listing.id,
        type: "ai_eval",
        prompt: transcriptionPrompt,
        inputSource: "audio",
        stage: "preparing",
        steps: {
          includeTranscription,
          includeNormalization,
          includeCritique: true,
        },
        currentStep: 0,
        totalSteps,
      });

      // Create abort controller for cancellation
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Register cancel function
      taskCancellationRegistry.register(taskId, () => {
        abortController.abort();
        if (activeJobIdRef.current) {
          cancelJob(activeJobIdRef.current).catch(() => {});
        }
      });

      try {
        setTaskStatus(taskId, "processing");

        // Build job params
        const jobParams: Record<string, unknown> = {
          listing_id: listing.id,
          app_id: appId,
          transcription_prompt: transcriptionPrompt,
          evaluation_prompt: evaluationPrompt,
          transcription_schema: config?.schemas?.transcription?.schema ?? null,
          evaluation_schema: config?.schemas?.evaluation?.schema ?? null,
          skip_transcription: skipTranscription,
          normalize_original: config?.normalizeOriginal ?? false,
          prerequisites: config?.prerequisites ?? {},
          transcription_model: transcriptionModel,
          evaluation_model: evaluationModel,
        };

        // Submit and poll job
        const completedJob = await submitAndPollJob(
          "evaluate-voice-rx",
          jobParams,
          {
            signal: abortController.signal,
            pollIntervalMs: 2000,
            onProgress: (jp) => {
              // Map job progress to evaluation progress state
              const stage = _inferStage(jp.message);
              setProgress(jp.message);
              setProgressState({
                stage,
                message: jp.message,
                progress: jp.total > 0 ? Math.round((jp.current / jp.total) * 100) : undefined,
              });
              updateTask(taskId, {
                stage,
                currentStep: jp.current,
                progress: jp.total > 0 ? Math.round((jp.current / jp.total) * 100) : undefined,
              });
            },
          },
        );

        // Store job ID for cancellation
        activeJobIdRef.current = completedJob.id;

        if (completedJob.status === "failed") {
          throw new Error(completedJob.errorMessage || "Evaluation failed");
        }

        if (completedJob.status === "cancelled") {
          setTaskStatus(taskId, "cancelled");
          return null;
        }

        // Fetch updated listing to get the ai_eval result
        const updatedListing = await listingsRepository.getById(appId, listing.id);
        const evaluation = updatedListing?.aiEval as AIEvaluation | undefined;

        if (!evaluation) {
          throw new Error("Evaluation completed but no result found on listing");
        }

        // Complete task
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
        completeTask(taskId, evaluation);

        logEvaluationComplete(listing.id, {
          segmentCount: evaluation.llmTranscript?.segments?.length ?? 0,
          critiqueCount: evaluation.critique?.segments?.length ?? 0,
          skippedTranscription: skipTranscription,
        });

        notificationService.success("AI evaluation complete.");
        return evaluation;

      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setTaskStatus(taskId, "cancelled");
          return null;
        }

        const errorMessage =
          err instanceof Error ? err.message : "AI evaluation failed";

        logEvaluationFailed(listing.id, "transcription", errorMessage);

        setError(errorMessage);
        setProgressState({ stage: "failed", message: errorMessage });
        setTaskStatus(taskId, "failed", errorMessage);
        notificationService.error(errorMessage, "AI Evaluation failed");

        // Return a failed evaluation object for consistency
        return {
          id: generateId(),
          createdAt: new Date(),
          model: transcriptionModel,
          status: "failed" as const,
          error: errorMessage,
          prompts: {
            transcription: transcriptionPrompt,
            evaluation: evaluationPrompt,
          },
        } as AIEvaluation;

      } finally {
        setIsEvaluating(false);
        setProgress("");
        abortControllerRef.current = null;
        activeJobIdRef.current = null;
        taskCancellationRegistry.unregister(taskId);
      }
    },
    [
      appId,
      addTask,
      setTaskStatus,
      updateTask,
      completeTask,
    ],
  );

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

/** Infer evaluation stage from progress message text. */
function _inferStage(message: string): EvaluationStage {
  const lower = message.toLowerCase();
  if (lower.includes("transcrib")) return "transcribing";
  if (lower.includes("normaliz")) return "normalizing";
  if (lower.includes("critiqu") || lower.includes("compar") || lower.includes("evaluat")) return "critiquing";
  if (lower.includes("complete") || lower.includes("done")) return "complete";
  return "preparing";
}
