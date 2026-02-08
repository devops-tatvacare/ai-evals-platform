/**
 * Evaluation Pipeline Types
 * Core types for the unified evaluation pipeline
 */

import type {
  PipelineStep,
  StepValidationResult,
  StepExecutionContext,
  EvaluationProgressCallback,
  NormalizationStepResult,
  TranscriptionStepResult,
  EvaluationStepResult,
  EvaluationConfig,
  EvaluationPrerequisites,
  TranscriptionStepConfig,
  EvaluationStepConfig,
} from '@/types';

/**
 * Configuration for a specific step executor
 */
export type StepConfig = EvaluationPrerequisites | TranscriptionStepConfig | EvaluationStepConfig;

/**
 * Result from a step executor
 */
export type StepResult = NormalizationStepResult | TranscriptionStepResult | EvaluationStepResult;

/**
 * Step executor interface - all step executors implement this
 */
export interface IStepExecutor<TConfig extends StepConfig, TResult extends StepResult> {
  /** The step this executor handles */
  readonly step: PipelineStep;
  
  /**
   * Validate the configuration before execution
   */
  validate(config: TConfig, context: Partial<StepExecutionContext>): StepValidationResult;
  
  /**
   * Execute the step
   */
  execute(config: TConfig, context: StepExecutionContext): Promise<TResult>;
  
  /**
   * Cancel any in-progress execution
   */
  cancel(): void;
}

/**
 * Pipeline state during execution
 */
export interface PipelineState {
  /** Current step being executed */
  currentStep: PipelineStep | null;
  /** Step number (1-based) */
  stepNumber: number;
  /** Total number of steps */
  totalSteps: number;
  /** Whether pipeline is cancelled */
  isCancelled: boolean;
  /** Current abort controller */
  abortController: AbortController;
}

/**
 * Pipeline execution options
 */
export interface PipelineOptions {
  /** Progress callback */
  onProgress?: EvaluationProgressCallback;
}

/**
 * Result of pipeline execution
 */
export interface PipelineResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Normalization step result (if executed) */
  normalization?: NormalizationStepResult;
  /** Transcription step result */
  transcription?: TranscriptionStepResult;
  /** Evaluation step result */
  evaluation?: EvaluationStepResult;
  /** Error message (if failed) */
  error?: string;
  /** Which step failed */
  failedAt?: PipelineStep;
}

/**
 * Configuration for creating an evaluation config from UI inputs
 */
export interface EvaluationConfigBuilderInput {
  /** Source type (upload or api) */
  sourceType: 'upload' | 'api';
  /** Language setting */
  language: string;
  /** Source script (auto-detect or specific) */
  sourceScript: string;
  /** Target script for output */
  targetScript: string;
  /** Enable normalization */
  enableNormalization: boolean;
  /** Which transcripts to normalize */
  normalizationTarget: 'original' | 'judge' | 'both';
  /** Model for normalization */
  normalizationModel?: string;
  /** Preserve code-switching */
  preserveCodeSwitching: boolean;
  /** Skip transcription step */
  skipTranscription: boolean;
  /** Evaluation ID to reuse transcript from */
  reuseTranscriptFrom?: string;
  /** Transcription model */
  transcriptionModel: string;
  /** Transcription prompt */
  transcriptionPrompt: string;
  /** Transcription prompt ID */
  transcriptionPromptId?: string;
  /** Transcription schema */
  transcriptionSchema?: unknown;
  /** Use segments (upload flow) */
  useSegments: boolean;
  /** Evaluation model */
  evaluationModel: string;
  /** Evaluation prompt */
  evaluationPrompt: string;
  /** Evaluation prompt ID */
  evaluationPromptId?: string;
  /** Evaluation schema */
  evaluationSchema?: unknown;
}

/**
 * Build an EvaluationConfig from UI inputs
 */
export function buildEvaluationConfig(input: EvaluationConfigBuilderInput): EvaluationConfig {
  return {
    prerequisites: {
      language: input.language,
      sourceScript: input.sourceScript,
      targetScript: input.targetScript,
      normalizationEnabled: input.enableNormalization,
      normalizationTarget: input.normalizationTarget,
      preserveCodeSwitching: input.preserveCodeSwitching,
    },
    transcription: {
      skip: input.skipTranscription,
      reuseFromEvaluationId: input.reuseTranscriptFrom,
      model: input.transcriptionModel,
      prompt: input.transcriptionPrompt,
      promptId: input.transcriptionPromptId,
      schema: input.transcriptionSchema as import('@/types').SchemaDefinition | undefined,
      useSegments: input.useSegments,
    },
    evaluation: {
      model: input.evaluationModel,
      prompt: input.evaluationPrompt,
      promptId: input.evaluationPromptId,
      schema: input.evaluationSchema as import('@/types').SchemaDefinition | undefined,
    },
  };
}
