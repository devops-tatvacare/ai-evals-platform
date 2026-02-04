import type { TranscriptData } from './transcript.types';
import type { SchemaDefinition } from './schema.types';
import type { GeminiApiRx } from './api.types';

export type StructuredOutputStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type EvalStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type HumanEvalStatus = 'in_progress' | 'completed';

// Critique types for evaluation Call 2
export type CritiqueSeverity = 'none' | 'minor' | 'moderate' | 'critical';
export type LikelyCorrect = 'original' | 'judge' | 'both' | 'unclear';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

// Script detection types for multilingual support
export type DetectedScript = 'devanagari' | 'romanized' | 'mixed' | 'english' | 'unknown';

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

export interface ApiEvaluationCritique {
  transcriptComparison: {
    apiTranscript: string;
    judgeTranscript: string;
    overallMatch: number;
    critique: string;
  };
  structuredComparison: {
    fields: FieldCritique[];
    overallAccuracy: number;
    summary: string;
  };
  overallAssessment: string;
  generatedAt: Date;
  model: string;
}

// Semantic Audit Types (for Three-Pane Inspector UI)

export type SemanticErrorType = 'contradiction' | 'hallucination' | 'omission' | 'mismatch';
export type SemanticVerdict = 'PASS' | 'FAIL';

export interface SemanticFieldCritique {
  field_name: string;
  extracted_value: unknown;
  verdict: SemanticVerdict;
  error_type?: SemanticErrorType;
  reasoning: string;
  evidence_snippet?: string;
  correction?: string;
}

export interface SemanticAuditResult {
  factual_integrity_score: number;
  field_critiques: SemanticFieldCritique[];
  summary: string;
}



export interface AIEvaluation {
  id: string;
  createdAt: Date;
  model: string;
  status: EvalStatus;
  // Prompts used for this evaluation
  prompts?: {
    transcription: string;
    evaluation: string;
  };
  // Schemas used for this evaluation
  schemas?: {
    transcription?: SchemaDefinition;
    evaluation?: SchemaDefinition;
  };
  // Upload flow (segment-based)
  llmTranscript?: TranscriptData;
  critique?: EvaluationCritique;
  // API flow (document-based)
  judgeOutput?: {
    transcript: string;
    structuredData: GeminiApiRx;
  };
  apiCritique?: ApiEvaluationCritique;
  // Semantic audit result (for Three-Pane Inspector UI)
  semanticAuditResult?: SemanticAuditResult;
  // Normalization data
  normalizedOriginal?: TranscriptData;
  normalizationMeta?: {
    enabled: boolean;
    sourceScript: DetectedScript;
    targetScript: string;
    normalizedAt: Date;
  };
  error?: string;
  // Track which call failed
  failedAt?: 'transcription' | 'critique';
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
