/**
 * Evaluation Step Executor
 * Handles the critique/comparison step (Call 2)
 */

import type { 
  EvaluationStepConfig, 
  EvaluationStepResult, 
  StepExecutionContext,
  StepValidationResult,
  TranscriptData,
  SegmentCritique,
  AssessmentReference,
  EvaluationStatistics,
  CritiqueSeverity,
  LikelyCorrect,
  ConfidenceLevel,
  FieldCritique,
} from '@/types';
import { BaseStepExecutor } from './BaseStepExecutor';
import { createLLMPipelineWithModel } from '@/services/llm';
import type { LLMInvocationPipeline } from '@/services/llm';
import { resolvePrompt, type VariableContext } from '@/services/templates';
import { logCall2Start, logCall2Complete, logCall2Failed } from '@/services/logger';

export class EvaluationExecutor extends BaseStepExecutor<EvaluationStepConfig, EvaluationStepResult> {
  readonly step = 'evaluation' as const;
  
  private pipeline: LLMInvocationPipeline | null = null;
  
  override validate(
    config: EvaluationStepConfig, 
    context: Partial<StepExecutionContext>
  ): StepValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (!config.prompt) {
      errors.push('Evaluation prompt is required');
    }
    
    if (!config.model) {
      errors.push('Evaluation model is required');
    }
    
    if (!context.audioBlob) {
      errors.push('Audio file is required for evaluation');
    }
    
    if (!context.previousStepResults?.transcription) {
      errors.push('Transcription step must complete before evaluation');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  async execute(
    config: EvaluationStepConfig, 
    context: StepExecutionContext
  ): Promise<EvaluationStepResult> {
    this.resetCancellation();
    
    this.emitProgress(context, 0, 'Starting evaluation...');
    
    logCall2Start();
    
    try {
      // Create pipeline with specific model
      this.pipeline = createLLMPipelineWithModel(config.model);
      
      // Determine which transcripts to compare
      const { originalTranscript, judgeTranscript } = this.getComparisonTranscripts(context);
      
      // Detect if this is segment-based or API flow
      const useSegments = context.previousStepResults.transcription?.output.segments !== undefined;
      
      // Build variable context for prompt resolution
      const variableContext = this.buildVariableContext(
        context, 
        originalTranscript, 
        judgeTranscript,
        useSegments
      );
      const resolved = resolvePrompt(config.prompt, variableContext);
      
      // Track resolved variables
      const variables: Record<string, string> = {};
      for (const [key, value] of resolved.resolvedVariables) {
        if (typeof value === 'string') {
          variables[key] = value;
        }
      }
      
      // Track if audio is used ({{audio}} variable was in prompt)
      const usedAudio = config.prompt.includes('{{audio}}');
      
      // Remove {{audio}} placeholder since we send it as a file
      const cleanedPrompt = resolved.prompt.replace('{{audio}}', '[Audio file attached]');
      
      this.emitProgress(context, 10, 'Sending context to AI for evaluation...');
      
      this.checkCancellation();
      
      const response = await this.pipeline.invoke({
        prompt: cleanedPrompt,
        context: {
          source: 'voice-rx-eval',
          sourceId: `critique-${Date.now()}`,
        },
        output: {
          schema: config.schema?.schema,
          format: 'json',
        },
        media: {
          audio: {
            blob: context.audioBlob,
            mimeType: context.mimeType,
          },
        },
        config: {
          temperature: 0.3,
          maxOutputTokens: 131072,
          abortSignal: context.abortSignal,
        },
        stateTracking: {
          onProgress: (elapsed) => {
            const progress = Math.min(10 + Math.floor((elapsed / 180000) * 70), 79);
            this.emitProgress(context, progress, `Generating evaluation... (${Math.floor(elapsed / 1000)}s)`);
          },
        },
      });
      
      this.emitProgress(context, 80, 'Parsing evaluation response...');
      
      // Parse the response based on flow type
      const output = useSegments
        ? this.parseUploadFlowResponse(response.output.text, response.output.parsed, config.model)
        : this.parseApiFlowResponse(response.output.text, response.output.parsed, config.model);
      
      logCall2Complete(output.segmentCritiques?.length ?? output.structuredComparison?.fields?.length ?? 0);
      
      this.emitProgress(context, 100, 'Evaluation complete');
      
      return {
        usedAudio,
        output,
        prompt: config.prompt,
        schema: config.schema,
        variables,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during evaluation';
      logCall2Failed(message);
      throw error;
    }
  }
  
  override cancel(): void {
    super.cancel();
    this.pipeline?.cancel();
  }
  
  private getComparisonTranscripts(context: StepExecutionContext): {
    originalTranscript: TranscriptData | string;
    judgeTranscript: TranscriptData | string;
  } {
    const transcriptionResult = context.previousStepResults.transcription!;
    const normalizationResult = context.previousStepResults.normalization;
    
    // Determine original transcript
    let originalTranscript: TranscriptData | string;
    if (normalizationResult?.normalizedOriginal) {
      originalTranscript = normalizationResult.normalizedOriginal.transcript;
    } else if (context.originalTranscript) {
      originalTranscript = context.originalTranscript;
    } else {
      // API flow: use apiResponse.input
      originalTranscript = (context.apiResponse as { input: string })?.input ?? '';
    }
    
    // Determine judge transcript
    let judgeTranscript: TranscriptData | string;
    if (normalizationResult?.normalizedJudge) {
      judgeTranscript = normalizationResult.normalizedJudge.transcript;
    } else if (transcriptionResult.output.segments) {
      // Build TranscriptData from segments
      judgeTranscript = {
        formatVersion: '1.0',
        generatedAt: transcriptionResult.output.generatedAt.toISOString(),
        metadata: {
          recordingId: 'ai-generated',
          jobId: `eval-${Date.now()}`,
          processedAt: new Date().toISOString(),
        },
        speakerMapping: {},
        segments: transcriptionResult.output.segments,
        fullTranscript: transcriptionResult.output.transcript,
      };
    } else {
      judgeTranscript = transcriptionResult.output.transcript;
    }
    
    return { originalTranscript, judgeTranscript };
  }
  
  private buildVariableContext(
    context: StepExecutionContext,
    originalTranscript: TranscriptData | string,
    judgeTranscript: TranscriptData | string,
    useSegments: boolean
  ): VariableContext {
    const { useSettingsStore } = require('@/stores');
    const transcription = useSettingsStore.getState().transcription;
    
    // Build TranscriptData if we have a string
    const originalData = typeof originalTranscript === 'string' 
      ? this.stringToTranscriptData(originalTranscript)
      : originalTranscript;
    
    const judgeData = typeof judgeTranscript === 'string'
      ? this.stringToTranscriptData(judgeTranscript)
      : judgeTranscript;
    
    return {
      listing: {
        id: context.listingId,
        appId: 'voice-rx',
        title: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'processing',
        sourceType: useSegments ? 'upload' : 'api',
        transcript: originalData,
        apiResponse: context.apiResponse as import('@/types').GeminiApiResponse | undefined,
        structuredOutputReferences: [],
        structuredOutputs: [],
      },
      aiEval: {
        id: 'temp',
        createdAt: new Date(),
        model: '',
        status: 'processing',
        llmTranscript: judgeData,
        judgeOutput: context.previousStepResults.transcription?.output.structuredData 
          ? {
              transcript: context.previousStepResults.transcription.output.transcript,
              structuredData: context.previousStepResults.transcription.output.structuredData,
            }
          : undefined,
      },
      audioBlob: context.audioBlob,
      transcriptionPreferences: transcription,
    };
  }
  
  private stringToTranscriptData(text: string): TranscriptData {
    return {
      formatVersion: '1.0',
      generatedAt: new Date().toISOString(),
      metadata: {
        recordingId: 'converted',
        jobId: `conv-${Date.now()}`,
        processedAt: new Date().toISOString(),
      },
      speakerMapping: {},
      segments: [{
        speaker: 'Unknown',
        text,
        startTime: '00:00:00',
        endTime: '00:00:00',
      }],
      fullTranscript: text,
    };
  }
  
  private parseUploadFlowResponse(
    text: string,
    parsed: unknown,
    model: string
  ): EvaluationStepResult['output'] {
    let data = parsed;
    
    if (!data) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        }
      } catch {
        throw new Error('Failed to parse evaluation response as JSON');
      }
    }
    
    if (!data) {
      throw new Error('Invalid evaluation response: no data');
    }
    
    const parsed$ = data as Record<string, unknown>;
    
    const segments = this.parseSegmentCritiques(parsed$.segments as unknown[]);
    const assessmentReferences = this.parseAssessmentReferences(parsed$.assessmentReferences as unknown[]);
    const statistics = this.parseStatistics(parsed$.statistics as Record<string, unknown>, segments);
    
    return {
      model,
      generatedAt: new Date(),
      segmentCritiques: segments,
      statistics,
      overallAssessment: String(parsed$.overallAssessment || ''),
      assessmentReferences: assessmentReferences.length > 0 ? assessmentReferences : undefined,
    };
  }
  
  private parseApiFlowResponse(
    text: string,
    parsed: unknown,
    model: string
  ): EvaluationStepResult['output'] {
    let data = parsed;
    
    if (!data) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        }
      } catch {
        throw new Error('Failed to parse API evaluation response as JSON');
      }
    }
    
    if (!data) {
      throw new Error('Invalid API evaluation response: no data');
    }
    
    const parsed$ = data as Record<string, unknown>;
    
    const transcriptComparison = parsed$.transcriptComparison as {
      apiTranscript: string;
      judgeTranscript: string;
      overallMatch: number;
      critique: string;
    } | undefined;
    
    const structuredComparison = parsed$.structuredComparison as {
      fields: FieldCritique[];
      overallAccuracy: number;
      summary: string;
    } | undefined;
    
    return {
      model,
      generatedAt: new Date(),
      transcriptComparison,
      structuredComparison,
      overallAssessment: String(parsed$.overallAssessment || ''),
    };
  }
  
  private parseSegmentCritiques(segments: unknown[]): SegmentCritique[] {
    if (!segments || !Array.isArray(segments)) {
      return [];
    }
    
    return segments.map((seg, index) => {
      const s = seg as Record<string, unknown>;
      return {
        segmentIndex: typeof s.segmentIndex === 'number' ? s.segmentIndex : index,
        originalText: String(s.originalText || ''),
        judgeText: String(s.judgeText || s.llmText || ''),
        discrepancy: String(s.discrepancy || s.critique || ''),
        likelyCorrect: this.validateLikelyCorrect(s.likelyCorrect),
        confidence: this.validateConfidence(s.confidence),
        severity: this.validateSeverity(s.severity),
        category: s.category ? String(s.category) : undefined,
      };
    });
  }
  
  private parseAssessmentReferences(refs: unknown[]): AssessmentReference[] {
    if (!refs || !Array.isArray(refs)) {
      return [];
    }
    
    return refs
      .map((ref) => {
        const r = ref as Record<string, unknown>;
        if (typeof r.segmentIndex !== 'number') return null;
        return {
          segmentIndex: Number(r.segmentIndex),
          timeWindow: String(r.timeWindow || ''),
          issue: String(r.issue || ''),
          severity: this.validateSeverity(r.severity),
        };
      })
      .filter((r): r is AssessmentReference => r !== null);
  }
  
  private parseStatistics(
    stats: Record<string, unknown> | undefined,
    segments: SegmentCritique[]
  ): EvaluationStatistics | undefined {
    if (!stats) {
      // Compute from segments
      if (segments.length === 0) return undefined;
      
      return {
        totalSegments: segments.length,
        criticalCount: segments.filter(s => s.severity === 'critical').length,
        moderateCount: segments.filter(s => s.severity === 'moderate').length,
        minorCount: segments.filter(s => s.severity === 'minor').length,
        matchCount: segments.filter(s => s.severity === 'none' || s.likelyCorrect === 'both').length,
        originalCorrectCount: segments.filter(s => s.likelyCorrect === 'original').length,
        judgeCorrectCount: segments.filter(s => s.likelyCorrect === 'judge').length,
        unclearCount: segments.filter(s => s.likelyCorrect === 'unclear').length,
      };
    }
    
    return {
      totalSegments: Number(stats.totalSegments) || segments.length,
      criticalCount: Number(stats.criticalCount) || 0,
      moderateCount: Number(stats.moderateCount) || 0,
      minorCount: Number(stats.minorCount) || 0,
      matchCount: Number(stats.matchCount || stats.accurateCount) || 0,
      originalCorrectCount: Number(stats.originalCorrectCount) || 0,
      judgeCorrectCount: Number(stats.judgeCorrectCount) || 0,
      unclearCount: Number(stats.unclearCount) || 0,
    };
  }
  
  private validateSeverity(value: unknown): CritiqueSeverity {
    const valid = ['none', 'minor', 'moderate', 'critical'];
    const str = String(value).toLowerCase();
    return valid.includes(str) ? (str as CritiqueSeverity) : 'none';
  }
  
  private validateLikelyCorrect(value: unknown): LikelyCorrect {
    const valid = ['original', 'judge', 'both', 'unclear'];
    const str = String(value).toLowerCase();
    return valid.includes(str) ? (str as LikelyCorrect) : 'unclear';
  }
  
  private validateConfidence(value: unknown): ConfidenceLevel | undefined {
    if (!value) return undefined;
    const valid = ['high', 'medium', 'low'];
    const str = String(value).toLowerCase();
    return valid.includes(str) ? (str as ConfidenceLevel) : undefined;
  }
}
