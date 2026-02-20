import type { TranscriptData, TranscriptSegment } from './transcript.types';
import type { SchemaDefinition } from './schema.types';
import type { GeminiApiRx } from './api.types';

export type StructuredOutputStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type EvalStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type HumanEvalStatus = 'in_progress' | 'completed';

// === UNIFIED FLOW TYPE ===
export type FlowType = 'upload' | 'api';

// === PIPELINE STEP TYPES ===

/** Which transcripts to normalize */
export type NormalizationTarget = 'original' | 'judge' | 'both';

/** Pipeline step identifiers */
export type PipelineStep = 'normalization' | 'transcription' | 'evaluation';

// Critique types for evaluation Call 2
export type CritiqueSeverity = 'none' | 'minor' | 'moderate' | 'critical';
export type LikelyCorrect = 'original' | 'judge' | 'both' | 'unclear';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Script detection types for multilingual support (widened for i18n — any script ID is valid)
export type DetectedScript = string;

export interface ScriptDetectionResult {
  primaryScript: DetectedScript;
  confidence: number;
  segmentBreakdown?: Array<{ segmentIndex: number; detectedScript: DetectedScript }>;
}

export interface SegmentCritique {
  segmentIndex: number;
  originalText: string;
  judgeText: string; // renamed from llmText for clarity
  discrepancy: string; // renamed from critique for clarity
  likelyCorrect: LikelyCorrect;
  confidence?: ConfidenceLevel;
  severity: CritiqueSeverity;
  category?: string; // e.g., 'dosage', 'speaker', 'medical-term'
}

export interface EvaluationStatistics {
  totalSegments: number;
  criticalCount: number;
  moderateCount: number;
  minorCount: number;
  matchCount: number;
  originalCorrectCount: number;
  judgeCorrectCount: number;
  unclearCount: number;
}

/** Reference to a specific segment mentioned in the overall assessment */
export interface AssessmentReference {
  segmentIndex: number;
  timeWindow: string; // e.g., "00:01:23 - 00:01:45"
  issue: string; // Brief description of the issue at this segment
  severity: CritiqueSeverity;
}

export interface EvaluationCritique {
  segments: SegmentCritique[];
  overallAssessment: string;
  /** Segment references mentioned in the overall assessment for quick navigation */
  assessmentReferences?: AssessmentReference[];
  statistics?: EvaluationStatistics;
  generatedAt: Date;
  model: string;
}

export interface StructuredOutputReference {
  id: string;
  createdAt: Date;
  uploadedFile?: {
    name: string;
    size: number;
  };
  content: object;
  description?: string;
}

export interface StructuredOutput {
  id: string;
  createdAt: Date;
  prompt: string;
  promptType: 'freeform' | 'schema';
  inputSource: 'transcript' | 'audio' | 'both';
  model: string;
  generatedAt: Date;
  result: object | null;
  rawResponse?: string;
  status: StructuredOutputStatus;
  error?: string;
  referenceId?: string;
}

// API Flow Evaluation Types (for sourceType: 'api')

export interface FieldCritique {
  fieldPath: string;
  apiValue: unknown;
  judgeValue: unknown;
  match: boolean;
  critique: string;
  severity: CritiqueSeverity;
  confidence: ConfidenceLevel;
  /** Quote from transcript that supports this critique */
  evidenceSnippet?: string;
}

// === UNIFIED RESULT SHAPE (Phase 2) ===

export interface JudgeOutput {
  transcript: string;
  segments?: Array<Record<string, unknown>>;    // Upload flow only
  structuredData?: Record<string, unknown>;      // API flow only
}

export interface NormalizedOriginal {
  fullTranscript: string;
  segments?: Array<Record<string, unknown>>;     // Upload flow only
}

export interface NormalizationMeta {
  enabled: boolean;
  sourceScript: string;
  targetScript: string;
  normalizedAt?: string;
}

export interface UnifiedCritique {
  flowType: FlowType;
  overallAssessment: string;
  statistics?: Record<string, unknown>;    // Upload flow only; absent for API flow

  // Upload flow
  segments?: Array<Record<string, unknown>>;
  assessmentReferences?: Array<Record<string, unknown>>;

  // API flow
  fieldCritiques?: FieldCritique[];
  transcriptComparison?: Record<string, unknown>;

  rawOutput: Record<string, unknown>;
  generatedAt?: string;
  model?: string;
}

export interface AIEvaluation {
  id: string;
  createdAt: string;
  status: string;
  flowType: FlowType;
  models: { transcription: string; evaluation: string };
  prompts: { transcription: string; evaluation: string };
  warnings?: string[];
  error?: string;
  failedStep?: string;

  judgeOutput?: JudgeOutput;
  critique?: UnifiedCritique;
  normalizedOriginal?: NormalizedOriginal;
  normalizationMeta?: NormalizationMeta;
}

export interface TranscriptCorrection {
  segmentIndex: number;
  originalText: string;
  correctedText: string;
  reason?: string;
}

export interface HumanEvaluation {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  overallScore?: number;
  notes: string;
  corrections: TranscriptCorrection[];
  status: HumanEvalStatus;
}

// ============================================================================
// UNIFIED EVALUATION PIPELINE TYPES (Part 1 Refactor)
// ============================================================================

/**
 * Prerequisites configuration for evaluation pipeline (Step 1)
 */
/**
 * Prerequisites for evaluation - simplified flat structure for UI
 */
export interface EvaluationPrerequisites {
  /** Source language (Hindi, Tamil, Gujarati, English, Hinglish, etc.) */
  language: string;
  /** Detected or specified source script */
  sourceScript: string;
  /** Target script for output */
  targetScript: string;
  /** Enable normalization */
  normalizationEnabled: boolean;
  /** Which transcripts to normalize */
  normalizationTarget: NormalizationTarget;
  /** Preserve code-switching in output */
  preserveCodeSwitching: boolean;
  /** Model to use for normalization (optional, defaults to global LLM model) */
  normalizationModel?: string;
}

/**
 * Transcription step configuration (Step 2)
 */
export interface TranscriptionStepConfig {
  /** Skip transcription and reuse existing */
  skip: boolean;
  /** Evaluation ID to reuse transcript from */
  reuseFromEvaluationId?: string;
  /** Model to use for transcription */
  model: string;
  /** Resolved prompt text */
  prompt: string;
  /** Prompt entity ID (if using saved prompt) */
  promptId?: string;
  /** Schema for structured output */
  schema?: SchemaDefinition;
  /** Use time-aligned segments (upload flow) vs plain text (API flow) */
  useSegments: boolean;
}

/**
 * Evaluation/critique step configuration (Step 3)
 */
export interface EvaluationStepConfig {
  /** Model to use for evaluation (can differ from transcription) */
  model: string;
  /** Resolved prompt text */
  prompt: string;
  /** Prompt entity ID (if using saved prompt) */
  promptId?: string;
  /** Schema for structured output */
  schema?: SchemaDefinition;
}

/**
 * Complete configuration for an evaluation run
 * Passed to EvaluationPipeline to drive execution
 */
export interface EvaluationConfig {
  /** Step 1: Prerequisites and normalization settings */
  prerequisites: EvaluationPrerequisites;
  /** Step 2: Transcription settings */
  transcription: TranscriptionStepConfig;
  /** Step 3: Evaluation/critique settings */
  evaluation: EvaluationStepConfig;
}

// === STEP OUTPUT TYPES ===

/**
 * Cached normalization data for a transcript
 */
export interface NormalizedTranscriptCache {
  /** The normalized transcript */
  transcript: TranscriptData;
  /** If reused from previous evaluation, the source evaluation ID */
  cachedFrom?: string;
  /** When normalization was performed */
  normalizedAt: Date;
  /** Model used for normalization */
  model: string;
}

/**
 * Result of the normalization step
 */
export interface NormalizationStepResult {
  /** Whether normalization was enabled */
  enabled: boolean;
  /** Which transcripts were normalized */
  appliedTo: NormalizationTarget;
  /** Detected source language */
  sourceLanguage: string;
  /** Detected source script */
  sourceScript: DetectedScript;
  /** Target script for output */
  targetScript: string;
  /** Normalized original transcript (if appliedTo includes 'original') */
  normalizedOriginal?: NormalizedTranscriptCache;
  /** Normalized judge transcript (if appliedTo includes 'judge') - populated after Step 2 */
  normalizedJudge?: NormalizedTranscriptCache;
  /** Model used for normalization */
  model: string;
  /** When normalization completed */
  normalizedAt: Date;
}

/**
 * Unified transcription output - works for both upload and API flows
 */
export interface TranscriptionOutput {
  /** Full transcript text (always present) */
  transcript: string;
  /** Model used for transcription */
  model: string;
  /** When transcription was generated */
  generatedAt: Date;
  /** Time-aligned segments (upload flow only) */
  segments?: TranscriptSegment[];
  /** Structured data extraction (API flow only) */
  structuredData?: GeminiApiRx;
}

/**
 * Result of the transcription step
 */
export interface TranscriptionStepResult {
  /** Whether transcription was skipped (reused previous) */
  skipped: boolean;
  /** Evaluation ID if transcript was reused */
  reusedFrom?: string;
  /** Transcription output */
  output: TranscriptionOutput;
  /** Prompt used */
  prompt: string;
  /** Schema used */
  schema?: SchemaDefinition;
  /** Resolved variable values */
  variables: Record<string, string>;
}

/**
 * Unified evaluation output - works for both upload and API flows
 */
export interface EvaluationOutput {
  /** Model used for evaluation */
  model: string;
  /** When evaluation was generated */
  generatedAt: Date;
  /** Per-segment critiques (upload flow) */
  segmentCritiques?: SegmentCritique[];
  /** Critique statistics (upload flow) */
  statistics?: EvaluationStatistics;
  /** Transcript comparison (API flow) */
  transcriptComparison?: {
    overallMatch: number;
    critique: string;
  };
  /** Structured data comparison (API flow) */
  structuredComparison?: {
    fields: FieldCritique[];
    overallAccuracy: number;
    summary: string;
  };
  /** Overall assessment text */
  overallAssessment: string;
  /** References to specific segments in the assessment */
  assessmentReferences?: AssessmentReference[];
}

/**
 * Result of the evaluation step
 */
export interface EvaluationStepResult {
  /** Whether audio was included in this step */
  usedAudio: boolean;
  /** Evaluation output */
  output: EvaluationOutput;
  /** Prompt used */
  prompt: string;
  /** Schema used */
  schema?: SchemaDefinition;
  /** Resolved variable values */
  variables: Record<string, string>;
}

// === PROGRESS TRACKING ===

/**
 * Progress state for the evaluation pipeline
 */
export interface EvaluationProgressState {
  /** Current step being executed */
  currentStep: PipelineStep;
  /** 1-based step number */
  stepNumber: number;
  /** Total number of steps (depends on configuration) */
  totalSteps: number;
  /** Progress within current step (0-100) */
  stepProgress: number;
  /** Overall progress across all steps (0-100) */
  overallProgress: number;
  /** Human-readable status message */
  message: string;
  /** Legacy: evaluation stage for backward compatibility */
  stage?: string;
  /** Legacy: call number for backward compatibility */
  callNumber?: number;
}

/**
 * Callback for progress updates
 */
export type EvaluationProgressCallback = (progress: EvaluationProgressState) => void;

// === STEP EXECUTOR TYPES ===

/**
 * Validation result from a step executor
 */
export interface StepValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Context passed to step executors
 */
export interface StepExecutionContext {
  /** The listing being evaluated */
  listingId: string;
  /** Audio blob for transcription/evaluation */
  audioBlob: Blob;
  /** Audio MIME type */
  mimeType: string;
  /** Original transcript (from listing) */
  originalTranscript?: TranscriptData;
  /** API response (for API flow) */
  apiResponse?: unknown;
  /** Results from previous steps */
  previousStepResults: {
    normalization?: NormalizationStepResult;
    transcription?: TranscriptionStepResult;
  };
  /** Abort signal for cancellation */
  abortSignal: AbortSignal;
  /** Progress callback */
  onProgress: EvaluationProgressCallback;
  /** Prerequisites from evaluation config */
  prerequisites?: EvaluationPrerequisites;
}

