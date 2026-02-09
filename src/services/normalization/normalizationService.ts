/**
 * Normalization Service
 * Handles transliteration of transcripts from one script to another (e.g., Devanagari → Roman)
 * Uses LLM Pipeline for accurate, context-aware transliteration
 */

import { createLLMPipeline, createLLMPipelineWithModel } from '../llm';
import type { LLMInvocationPipeline } from '../llm';
import type { TranscriptData, DetectedScript, TranscriptSegment } from '@/types';

const NORMALIZATION_PROMPT = `You are an expert in Hindi-English transliteration and Indian language processing.

TASK: Transliterate the following transcript from {{sourceScript}} script to {{targetScript}} script.

RULES:
1. Convert all Devanagari text to Roman script using standard transliteration (e.g., "ये" → "ye", "कभी" → "kabhi")
2. Preserve English words exactly as-is
3. Keep speaker labels unchanged
4. Keep timestamps unchanged (startTime, endTime, startSeconds, endSeconds)
5. Maintain medical terminology accurately
6. For code-switched content (Hinglish), transliterate Hindi portions while keeping English portions intact
7. Return EXACT same JSON structure with same number of segments

INPUT TRANSCRIPT:
{{transcript_json}}

OUTPUT: Return the transliterated transcript in JSON format with the same structure.`;

export class NormalizationService {
  private pipeline: LLMInvocationPipeline;
  
  constructor(modelName?: string) {
    this.pipeline = modelName 
      ? createLLMPipelineWithModel(modelName)
      : createLLMPipeline();
  }

  /**
   * Normalize (transliterate) a transcript from source script to target script
   */
  async normalize(
    originalTranscript: TranscriptData,
    targetScript: string,
    sourceScript?: DetectedScript,
    modelName?: string
  ): Promise<TranscriptData> {
    // Create pipeline with specific model if provided
    const pipeline = modelName 
      ? createLLMPipelineWithModel(modelName)
      : this.pipeline;
    const prompt = NORMALIZATION_PROMPT
      .replace('{{sourceScript}}', sourceScript || 'Devanagari')
      .replace('{{targetScript}}', targetScript)
      .replace('{{transcript_json}}', JSON.stringify(originalTranscript, null, 2));
    
    const schema = {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              speaker: { type: 'string' },
              text: { type: 'string' },
              startTime: { type: 'string' },
              endTime: { type: 'string' },
            },
            required: ['speaker', 'text', 'startTime', 'endTime'],
          },
        },
      },
      required: ['segments'],
    };
    
    const response = await pipeline.invoke({
      prompt,
      context: {
        source: 'normalization',
        sourceId: `norm-${Date.now()}`,
      },
      output: {
        schema,
        format: 'json',
      },
      config: {
        temperature: 0.1, // Low temperature for consistency
        maxOutputTokens: 131072, // 128K to account for thinking tokens (62K+) + actual output
      },
    });
    
    // Parse response with error handling
    let parsed: { segments: TranscriptSegment[] };
    
    if (response.output.parsed) {
      parsed = response.output.parsed as { segments: TranscriptSegment[] };
    } else {
      try {
        parsed = JSON.parse(response.output.text);
      } catch (err) {
        console.error('[Normalization] Failed:', err);
        console.error('[Normalization] Raw response:', response.output.text.substring(0, 500));
        throw new Error(`Failed to parse normalization response: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    // Validate response structure
    if (!parsed.segments || !Array.isArray(parsed.segments)) {
      throw new Error('Invalid normalization response: missing or invalid segments array');
    }
    
    // Merge with original transcript structure to preserve metadata
    const normalizedSegments: TranscriptSegment[] = parsed.segments.map((seg: TranscriptSegment, idx: number) => ({
      speaker: seg.speaker,
      text: seg.text,
      startTime: seg.startTime,
      endTime: seg.endTime,
      // Preserve numeric timestamps if they exist
      startSeconds: originalTranscript.segments[idx]?.startSeconds,
      endSeconds: originalTranscript.segments[idx]?.endSeconds,
    }));
    
    // Reconstruct full transcript
    const fullTranscript = normalizedSegments
      .map((s) => `[${s.speaker}]: ${s.text}`)
      .join('\n');
    
    return {
      ...originalTranscript,
      segments: normalizedSegments,
      fullTranscript,
      generatedAt: new Date().toISOString(), // Update generation timestamp
    };
  }
  
  /**
   * Cancel any in-progress normalization
   */
  cancel(): void {
    this.pipeline.cancel();
  }
}

/**
 * Create a normalization service instance
 * @param modelName Optional model name to use for normalization
 */
export function createNormalizationService(modelName?: string): NormalizationService {
  return new NormalizationService(modelName);
}
