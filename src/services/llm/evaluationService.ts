/**
 * Evaluation Service
 * Handles the two-call evaluation flow:
 * - Call 1: Transcription (audio → transcript)
 * - Call 2: Critique (audio + original + AI transcript → per-segment critique)
 */

import type {
  TranscriptData,
  TranscriptSegment,
  EvaluationCritique,
  SegmentCritique,
  AssessmentReference,
  EvaluationStage,
  EvaluationCallNumber,
} from '@/types';
import { GeminiProvider } from './GeminiProvider';
import { resolvePrompt, type VariableContext } from '../templates';
import { logCall1Start, logCall1Complete, logCall1Failed, logCall2Start, logCall2Complete, logCall2Failed } from '../logger/evaluationLogger';

export interface TranscriptionResult {
  transcript: TranscriptData;
  rawResponse: string;
}

export interface CritiqueResult {
  critique: EvaluationCritique;
  rawResponse: string;
}

export interface EvaluationProgress {
  stage: EvaluationStage;
  message: string;
  callNumber?: EvaluationCallNumber;
  progress?: number;
}

export interface EvaluationPrompts {
  transcription: string;
  evaluation: string;
}

/**
 * Try to repair truncated JSON by closing open brackets
 */
function repairTruncatedJson(json: string): string {
  let repaired = json.trim();
  
  // Count open brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escapeNext = false;
  
  for (const char of repaired) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') openBraces++;
      if (char === '}') openBraces--;
      if (char === '[') openBrackets++;
      if (char === ']') openBrackets--;
    }
  }
  
  // If we're in a string, close it
  if (inString) {
    repaired += '"';
  }
  
  // Close open brackets
  while (openBrackets > 0) {
    repaired += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    repaired += '}';
    openBraces--;
  }
  
  return repaired;
}

/**
 * Parse LLM response to transcript data
 */
function parseTranscriptResponse(response: string): TranscriptData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  
  // First, try to parse the response directly as JSON (for structured output responses)
  try {
    const trimmed = response.trim();
    parsed = JSON.parse(trimmed);
  } catch (parseError) {
    // Try to repair truncated JSON
    try {
      const repaired = repairTruncatedJson(response);
      parsed = JSON.parse(repaired);
      console.warn('Repaired truncated JSON response');
    } catch {
      // If repair fails, try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('Failed to parse transcription response:', response.substring(0, 500));
        throw new Error(`Invalid JSON in transcription response: ${parseError instanceof Error ? parseError.message : 'Parse error'}`);
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Try repairing extracted JSON
        const repaired = repairTruncatedJson(jsonMatch[0]);
        parsed = JSON.parse(repaired);
      }
    }
  }
  
  // Handle different response formats
  const segments: TranscriptSegment[] = (parsed.segments || []).map((seg: unknown, index: number) => {
    const s = seg as Record<string, unknown>;
    return {
      speaker: String(s.speaker || 'Unknown'),
      text: String(s.text || ''),
      startTime: String(s.startTime ?? s.start_time ?? index),
      endTime: String(s.endTime ?? s.end_time ?? index + 1),
      startSeconds: typeof s.startTime === 'number' ? s.startTime : undefined,
      endSeconds: typeof s.endTime === 'number' ? s.endTime : undefined,
    };
  });

  // Build full transcript
  const fullTranscript = segments.map((s) => `[${s.speaker}]: ${s.text}`).join('\n');

  return {
    formatVersion: '1.0',
    generatedAt: new Date().toISOString(),
    metadata: {
      recordingId: 'ai-generated',
      jobId: `eval-${Date.now()}`,
      processedAt: new Date().toISOString(),
    },
    speakerMapping: {},
    segments,
    fullTranscript,
  };
}

/**
 * Parse LLM response to critique data
 */
function parseCritiqueResponse(
  response: string,
  originalSegments: TranscriptSegment[],
  llmSegments: TranscriptSegment[],
  model: string
): EvaluationCritique {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  
  // First, try to parse the response directly as JSON (for structured output responses)
  try {
    const trimmed = response.trim();
    parsed = JSON.parse(trimmed);
  } catch (parseError) {
    // Try to repair truncated JSON
    try {
      const repaired = repairTruncatedJson(response);
      parsed = JSON.parse(repaired);
      console.warn('Repaired truncated JSON critique response');
    } catch {
      // If repair fails, try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('Failed to parse critique response:', response.substring(0, 500));
        throw new Error(`Invalid JSON in critique response: ${parseError instanceof Error ? parseError.message : 'Parse error'}`);
      }
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Try repairing extracted JSON
        const repaired = repairTruncatedJson(jsonMatch[0]);
        parsed = JSON.parse(repaired);
      }
    }
  }

  const segments: SegmentCritique[] = (parsed.segments || []).map((seg: unknown, index: number) => {
    const s = seg as Record<string, unknown>;
    const segIdx = typeof s.segmentIndex === 'number' ? s.segmentIndex : index;
    
    return {
      segmentIndex: segIdx,
      originalText: String(s.originalText || originalSegments[segIdx]?.text || ''),
      judgeText: String(s.judgeText || s.llmText || llmSegments[segIdx]?.text || ''),
      discrepancy: String(s.discrepancy || s.critique || ''),
      likelyCorrect: validateLikelyCorrect(s.likelyCorrect),
      confidence: validateConfidence(s.confidence),
      severity: validateSeverity(s.severity),
      category: s.category ? String(s.category) : undefined,
    };
  });

  // Parse assessment references (for clickable navigation)
  const assessmentReferences: AssessmentReference[] = (parsed.assessmentReferences || [])
    .map((ref: unknown) => {
      const r = ref as Record<string, unknown>;
      if (typeof r.segmentIndex !== 'number') return null;
      return {
        segmentIndex: Number(r.segmentIndex),
        timeWindow: String(r.timeWindow || ''),
        issue: String(r.issue || ''),
        severity: validateSeverity(r.severity),
      };
    })
    .filter((r: AssessmentReference | null): r is AssessmentReference => r !== null);

  return {
    segments,
    overallAssessment: String(parsed.overallAssessment || ''),
    assessmentReferences: assessmentReferences.length > 0 ? assessmentReferences : undefined,
    statistics: parsed.statistics ? {
      totalSegments: Number(parsed.statistics.totalSegments) || segments.length,
      criticalCount: Number(parsed.statistics.criticalCount) || 0,
      moderateCount: Number(parsed.statistics.moderateCount) || 0,
      minorCount: Number(parsed.statistics.minorCount) || 0,
      matchCount: Number(parsed.statistics.matchCount || parsed.statistics.accurateCount) || 0,
      originalCorrectCount: Number(parsed.statistics.originalCorrectCount) || 0,
      judgeCorrectCount: Number(parsed.statistics.judgeCorrectCount) || 0,
      unclearCount: Number(parsed.statistics.unclearCount) || 0,
    } : undefined,
    generatedAt: new Date(),
    model,
  };
}

function validateSeverity(value: unknown): SegmentCritique['severity'] {
  const valid = ['none', 'minor', 'moderate', 'critical'];
  const str = String(value).toLowerCase();
  return valid.includes(str) ? (str as SegmentCritique['severity']) : 'none';
}

function validateLikelyCorrect(value: unknown): SegmentCritique['likelyCorrect'] {
  const valid = ['original', 'judge', 'both', 'unclear'];
  const str = String(value).toLowerCase();
  return valid.includes(str) ? (str as SegmentCritique['likelyCorrect']) : 'unclear';
}

function validateConfidence(value: unknown): SegmentCritique['confidence'] | undefined {
  if (!value) return undefined;
  const valid = ['high', 'medium', 'low'];
  const str = String(value).toLowerCase();
  return valid.includes(str) ? (str as SegmentCritique['confidence']) : undefined;
}

export class EvaluationService {
  private provider: GeminiProvider;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.provider = new GeminiProvider(apiKey, model);
    this.model = model;
  }

  /**
   * Call 1: Transcription
   * Send audio to LLM and get back a transcript
   */
  async transcribe(
    audioBlob: Blob,
    mimeType: string,
    prompt: string,
    schema: Record<string, unknown> | undefined,
    onProgress: (progress: EvaluationProgress) => void
  ): Promise<TranscriptionResult> {
    onProgress({
      stage: 'transcribing',
      message: 'Sending audio to AI for transcription...',
      callNumber: 1,
      progress: 10,
    });

    logCall1Start();

    try {
      const response = await this.provider.generateContentWithAudio(
        prompt,
        audioBlob,
        mimeType,
        { 
          temperature: 0.3,
          responseSchema: schema,
        }
      );

      onProgress({
        stage: 'transcribing',
        message: 'Parsing transcription response...',
        callNumber: 1,
        progress: 80,
      });

      const transcript = parseTranscriptResponse(response.text);
      
      logCall1Complete(transcript.segments.length);

      return {
        transcript,
        rawResponse: response.text,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during transcription';
      logCall1Failed(message);
      throw error;
    }
  }

  /**
   * Call 2: Critique
   * Send audio, original transcript, and AI transcript to get critique
   */
  async critique(
    context: {
      audioBlob: Blob;
      mimeType: string;
      originalTranscript: TranscriptData;
      llmTranscript: TranscriptData;
    },
    prompt: string,
    schema: Record<string, unknown> | undefined,
    onProgress: (progress: EvaluationProgress) => void
  ): Promise<CritiqueResult> {
    onProgress({
      stage: 'critiquing',
      message: 'Generating AI critique...',
      callNumber: 2,
      progress: 10,
    });

    logCall2Start();

    try {
      // Resolve text variables in the prompt
      const variableContext: VariableContext = {
        listing: {
          id: 'temp',
          appId: 'voice-rx', // Placeholder for variable resolution
          title: '',
          createdAt: new Date(),
          updatedAt: new Date(),
          status: 'processing',
          transcript: context.originalTranscript,
          structuredOutputReferences: [],
          structuredOutputs: [],
        },
        aiEval: {
          id: 'temp',
          createdAt: new Date(),
          model: this.model,
          status: 'processing',
          llmTranscript: context.llmTranscript,
        },
        audioBlob: context.audioBlob,
      };

      const resolved = resolvePrompt(prompt, variableContext);
      
      // Check for unresolved variables (excluding {{audio}} which is handled separately)
      const unresolvedText = resolved.unresolvedVariables.filter(v => v !== '{{audio}}');
      if (unresolvedText.length > 0) {
        throw new Error(`Unresolved variables in evaluation prompt: ${unresolvedText.join(', ')}`);
      }

      onProgress({
        stage: 'critiquing',
        message: 'Sending context to AI for critique...',
        callNumber: 2,
        progress: 30,
      });

      // Remove the {{audio}} placeholder since we'll send it as a file
      const cleanedPrompt = resolved.prompt.replace('{{audio}}', '[Audio file attached]');

      const response = await this.provider.generateContentWithAudio(
        cleanedPrompt,
        context.audioBlob,
        context.mimeType,
        { 
          temperature: 0.3,
          responseSchema: schema,
        }
      );

      onProgress({
        stage: 'critiquing',
        message: 'Parsing critique response...',
        callNumber: 2,
        progress: 80,
      });

      const critique = parseCritiqueResponse(
        response.text,
        context.originalTranscript.segments,
        context.llmTranscript.segments,
        this.model
      );

      logCall2Complete(critique.segments.length);

      return {
        critique,
        rawResponse: response.text,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during critique';
      logCall2Failed(message);
      throw error;
    }
  }

  /**
   * Cancel any in-progress operation
   */
  cancel(): void {
    this.provider.cancel();
  }
}

/**
 * Create an evaluation service instance
 */
export function createEvaluationService(apiKey: string, model: string): EvaluationService {
  return new EvaluationService(apiKey, model);
}
