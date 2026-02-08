/**
 * Normalization Step Executor
 * Handles transliteration of transcripts between scripts
 */

import type { 
  EvaluationPrerequisites, 
  NormalizationStepResult, 
  StepExecutionContext,
  StepValidationResult,
  TranscriptData,
  DetectedScript,
  NormalizedTranscriptCache,
} from '@/types';
import { BaseStepExecutor } from './BaseStepExecutor';
import { createLLMPipelineWithModel } from '@/services/llm';
import type { LLMInvocationPipeline } from '@/services/llm';
import { detectTranscriptScript } from '@/services/normalization';
import { logNormalizationStart, logNormalizationComplete, logNormalizationSkipped } from '@/services/logger';

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

const NORMALIZATION_SCHEMA = {
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

export class NormalizationExecutor extends BaseStepExecutor<EvaluationPrerequisites, NormalizationStepResult> {
  readonly step = 'normalization' as const;
  
  private pipeline: LLMInvocationPipeline | null = null;
  
  override validate(
    config: EvaluationPrerequisites, 
    context: Partial<StepExecutionContext>
  ): StepValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!config.normalizationEnabled) {
      warnings.push('Normalization is disabled, step will be skipped');
    }
    
    if (config.normalizationEnabled) {
      if (!config.targetScript) {
        errors.push('Target script is required when normalization is enabled');
      }
      
      if (!config.normalizationTarget) {
        errors.push('Must specify which transcripts to normalize (original, judge, or both)');
      }
      
      // Check if original transcript is available
      const needsOriginal = config.normalizationTarget === 'original' || 
                           config.normalizationTarget === 'both';
      if (needsOriginal && !context.originalTranscript) {
        errors.push('Original transcript is required for normalization');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  async execute(
    config: EvaluationPrerequisites, 
    context: StepExecutionContext
  ): Promise<NormalizationStepResult> {
    this.resetCancellation();
    
    // If normalization is disabled, return a disabled result
    if (!config.normalizationEnabled) {
      return {
        enabled: false,
        appliedTo: config.normalizationTarget,
        sourceLanguage: config.language,
        sourceScript: 'unknown',
        targetScript: config.targetScript,
        model: '',
        normalizedAt: new Date(),
      };
    }
    
    this.emitProgress(context, 0, 'Starting normalization...');
    
    // Detect source script from original transcript
    const originalTranscript = context.originalTranscript;
    if (!originalTranscript) {
      throw new Error('Original transcript is required for normalization');
    }
    
    const scriptDetection = detectTranscriptScript(originalTranscript);
    const sourceScript = scriptDetection.primaryScript;
    
    logNormalizationStart(context.listingId, sourceScript, config.targetScript);
    
    // Smart skip: Don't normalize if source and target are compatible
    if (this.shouldSkipNormalization(sourceScript, config.targetScript)) {
      logNormalizationSkipped(context.listingId, 'Source and target scripts are compatible');
      
      return {
        enabled: false,
        appliedTo: config.normalizationTarget,
        sourceLanguage: config.language,
        sourceScript,
        targetScript: config.targetScript,
        model: '',
        normalizedAt: new Date(),
      };
    }
    
    this.checkCancellation();
    
    // Get model from config or use default
    const model = this.resolveModel(config);
    
    // Create pipeline with specific model
    this.pipeline = createLLMPipelineWithModel(model);
    
    const result: NormalizationStepResult = {
      enabled: true,
      appliedTo: config.normalizationTarget,
      sourceLanguage: config.language,
      sourceScript,
      targetScript: config.targetScript,
      model,
      normalizedAt: new Date(),
    };
    
    // Normalize original transcript if requested
    if (config.normalizationTarget === 'original' || config.normalizationTarget === 'both') {
      this.emitProgress(context, 30, 'Normalizing original transcript...');
      
      this.checkCancellation();
      
      const normalizedOriginal = await this.normalizeTranscript(
        originalTranscript,
        sourceScript,
        config.targetScript,
        context.abortSignal
      );
      
      result.normalizedOriginal = {
        transcript: normalizedOriginal,
        normalizedAt: new Date(),
        model,
      };
    }
    
    // Note: Judge transcript normalization happens after transcription step
    // The pipeline will handle this by updating the normalization result
    
    logNormalizationComplete(
      context.listingId, 
      result.normalizedOriginal?.transcript.segments.length ?? 0
    );
    
    this.emitProgress(context, 100, 'Normalization complete');
    
    return result;
  }
  
  /**
   * Normalize judge transcript after transcription step
   * Called by the pipeline after transcription completes
   */
  async normalizeJudgeTranscript(
    judgeTranscript: TranscriptData,
    normalizationResult: NormalizationStepResult,
    abortSignal: AbortSignal
  ): Promise<NormalizedTranscriptCache> {
    if (!this.pipeline) {
      this.pipeline = createLLMPipelineWithModel(normalizationResult.model);
    }
    
    const normalizedTranscript = await this.normalizeTranscript(
      judgeTranscript,
      normalizationResult.sourceScript,
      normalizationResult.targetScript,
      abortSignal
    );
    
    return {
      transcript: normalizedTranscript,
      normalizedAt: new Date(),
      model: normalizationResult.model,
    };
  }
  
  override cancel(): void {
    super.cancel();
    this.pipeline?.cancel();
  }
  
  private shouldSkipNormalization(sourceScript: DetectedScript, targetScript: string): boolean {
    const sourceNormalized = (sourceScript === 'romanized' || sourceScript === 'english') 
      ? 'roman' 
      : sourceScript;
    const targetNormalized = targetScript.toLowerCase();
    
    return sourceNormalized === targetNormalized || 
           (sourceNormalized === 'roman' && targetNormalized === 'roman') ||
           (sourceNormalized === 'devanagari' && targetNormalized === 'devanagari');
  }
  
  private resolveModel(_config: EvaluationPrerequisites): string {
    // TODO: Get model from per-step config when UI supports it
    // For now, use the global model from settings
    const { useSettingsStore } = require('@/stores');
    const llm = useSettingsStore.getState().llm;
    return llm.stepModels?.normalization || llm.selectedModel;
  }
  
  private async normalizeTranscript(
    transcript: TranscriptData,
    sourceScript: DetectedScript,
    targetScript: string,
    abortSignal: AbortSignal
  ): Promise<TranscriptData> {
    const prompt = NORMALIZATION_PROMPT
      .replace('{{sourceScript}}', sourceScript || 'Devanagari')
      .replace('{{targetScript}}', targetScript)
      .replace('{{transcript_json}}', JSON.stringify(transcript, null, 2));
    
    const response = await this.pipeline!.invoke({
      prompt,
      context: {
        source: 'normalization',
        sourceId: `norm-${Date.now()}`,
      },
      output: {
        schema: NORMALIZATION_SCHEMA,
        format: 'json',
      },
      config: {
        temperature: 0.1,
        maxOutputTokens: 131072,
        abortSignal,
      },
    });
    
    // Parse response
    let parsed: { segments: TranscriptData['segments'] };
    
    if (response.output.parsed) {
      parsed = response.output.parsed as { segments: TranscriptData['segments'] };
    } else {
      try {
        parsed = JSON.parse(response.output.text);
      } catch (err) {
        throw new Error(`Failed to parse normalization response: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    if (!parsed.segments || !Array.isArray(parsed.segments)) {
      throw new Error('Invalid normalization response: missing or invalid segments array');
    }
    
    // Merge with original structure to preserve metadata
    const normalizedSegments = parsed.segments.map((seg, idx) => ({
      speaker: seg.speaker,
      text: seg.text,
      startTime: seg.startTime,
      endTime: seg.endTime,
      startSeconds: transcript.segments[idx]?.startSeconds,
      endSeconds: transcript.segments[idx]?.endSeconds,
    }));
    
    const fullTranscript = normalizedSegments
      .map((s) => `[${s.speaker}]: ${s.text}`)
      .join('\n');
    
    return {
      ...transcript,
      segments: normalizedSegments,
      fullTranscript,
      generatedAt: new Date().toISOString(),
    };
  }
}
