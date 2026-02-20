import { useState, useCallback, useRef } from "react";
import { useLLMSettingsStore, useTaskQueueStore, useAppStore, useJobTrackerStore, useGlobalSettingsStore } from "@/stores";
import { notificationService } from "@/services/notifications";
import {
  logEvaluationStart,
  logEvaluationComplete,
  logEvaluationFailed,
  logEvaluationFlowSelected,
} from "@/services/logger";
import { submitAndPollJob, cancelJob } from "@/services/api/jobPolling";
import { fetchLatestRun } from "@/services/api/evalRunsApi";
import type {
  AIEvaluation,
  Listing,
  EvaluationStage,
} from "@/types";
import { generateId } from "@/utils";
import { taskCancellationRegistry } from "@/services/taskCancellation";

export interface EvaluationProgressState {
  stage: EvaluationStage;
  message: string;
  progress?: number;
}

export interface EvaluationConfig {
  /** Model to use for all pipeline steps (overrides global store default) */
  model?: string;
  /** Thinking level: "off", "low", "medium", "high" */
  thinking?: string;
  /** Normalize original transcript to target script before evaluation */
  normalizeOriginal?: boolean;
  /** Prerequisites config from wizard */
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

      // Use model from config (overlay selection) or fall back to store default
      const llm = useLLMSettingsStore.getState();
      const selectedModel = config?.model || llm.selectedModel;

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
        transcription: "[backend-managed]",
        evaluation: "[backend-managed]",
      });

      // Determine steps for task queue
      const includeNormalization =
        hasUploadTranscript && (config?.normalizeOriginal ?? false);

      let totalSteps = 1; // transcription always runs
      if (includeNormalization) totalSteps++;
      totalSteps++; // critique always runs

      const taskId = addTask({
        listingId: listing.id,
        type: "ai_eval",
        prompt: "[backend-managed]",
        inputSource: "audio",
        stage: "preparing",
        steps: {
          includeTranscription: true,
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

        // Build job params (backend loads prompts/schemas internally)
        const { timeouts } = useGlobalSettingsStore.getState();
        const jobParams: Record<string, unknown> = {
          listing_id: listing.id,
          app_id: appId,
          normalize_original: config?.normalizeOriginal ?? false,
          prerequisites: config?.prerequisites ?? {},
          model: selectedModel,
          thinking: config?.thinking ?? "low",
          timeouts: {
            text_only: timeouts.textOnly,
            with_schema: timeouts.withSchema,
            with_audio: timeouts.withAudio,
            with_audio_and_schema: timeouts.withAudioAndSchema,
          },
        };

        // Submit and poll job
        const completedJob = await submitAndPollJob(
          "evaluate-voice-rx",
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

        if (completedJob.status === "failed") {
          throw new Error(completedJob.errorMessage || "Evaluation failed");
        }

        if (completedJob.status === "cancelled") {
          setTaskStatus(taskId, "cancelled");
          return null;
        }

        // Fetch latest full_evaluation eval run to get the result
        const latestRun = await fetchLatestRun({
          listing_id: listing.id,
          eval_type: 'full_evaluation',
        });
        const evaluation = latestRun?.result as AIEvaluation | undefined;

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
          segmentCount: evaluation.judgeOutput?.segments?.length ?? 0,
          critiqueCount: evaluation.critique?.segments?.length ?? 0,
          skippedTranscription: false,
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
          createdAt: new Date().toISOString(),
          flowType: "upload",
          models: { transcription: selectedModel, evaluation: "" },
          status: "failed" as const,
          error: errorMessage,
          prompts: {
            transcription: "[backend-managed]",
            evaluation: "[backend-managed]",
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
