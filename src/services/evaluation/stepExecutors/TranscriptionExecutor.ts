/**
 * Transcription Step Executor
 * Handles audio transcription (Call 1)
 */

import type { 
  TranscriptionStepConfig, 
  TranscriptionStepResult, 
  StepExecutionContext,
  StepValidationResult,
  TranscriptSegment,
} from '@/types';
import { BaseStepExecutor } from './BaseStepExecutor';
import { createLLMPipelineWithModel } from '@/services/llm';
import type { LLMInvocationPipeline } from '@/services/llm';
import { resolvePrompt, type VariableContext } from '@/services/templates';
import { logCall1Start, logCall1Complete, logCall1Failed, logCall1Skipped } from '@/services/logger';

export class TranscriptionExecutor extends BaseStepExecutor<TranscriptionStepConfig, TranscriptionStepResult> {
  readonly step = 'transcription' as const;
  
  private pipeline: LLMInvocationPipeline | null = null;
  
  override validate(
    config: TranscriptionStepConfig, 
    context: Partial<StepExecutionContext>
  ): StepValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (config.skip) {
      if (!config.reuseFromEvaluationId) {
        warnings.push('Skip enabled but no reuse source specified');
      }
    } else {
      if (!config.prompt) {
        errors.push('Transcription prompt is required');
      }
      
      if (!config.model) {
        errors.push('Transcription model is required');
      }
      
      if (!context.audioBlob) {
        errors.push('Audio file is required for transcription');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  async execute(
    config: TranscriptionStepConfig, 
    context: StepExecutionContext
  ): Promise<TranscriptionStepResult> {
    this.resetCancellation();
    
    // Handle skip/reuse case
    if (config.skip) {
      return this.handleSkipTranscription(config, context);
    }
    
    this.emitProgress(context, 0, 'Starting transcription...');
    
    logCall1Start();
    
    try {
      // Create pipeline with specific model
      this.pipeline = createLLMPipelineWithModel(config.model);
      
      // Build variable context for prompt resolution
      const variableContext = this.buildVariableContext(context, config);
      const resolved = resolvePrompt(config.prompt, variableContext);
      
      // Track resolved variables (excluding audio which is handled separately)
      const variables: Record<string, string> = {};
      for (const [key, value] of resolved.resolvedVariables) {
        if (typeof value === 'string') {
          variables[key] = value;
        }
      }
      
      this.emitProgress(context, 10, 'Sending audio to AI for transcription...');
      
      this.checkCancellation();
      
      const response = await this.pipeline.invoke({
        prompt: resolved.prompt,
        context: {
          source: 'voice-rx-eval',
          sourceId: `transcribe-${Date.now()}`,
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
            this.emitProgress(context, progress, `Transcribing audio... (${Math.floor(elapsed / 1000)}s)`);
          },
        },
      });
      
      this.emitProgress(context, 80, 'Parsing transcription response...');
      
      // Parse the response
      const { transcript, segments, structuredData } = this.parseResponse(
        response.output.text,
        response.output.parsed,
        config.useSegments
      );
      
      logCall1Complete(segments?.length ?? 1);
      
      this.emitProgress(context, 100, 'Transcription complete');
      
      return {
        skipped: false,
        output: {
          transcript,
          model: config.model,
          generatedAt: new Date(),
          segments,
          structuredData,
        },
        prompt: config.prompt,
        schema: config.schema,
        variables,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during transcription';
      logCall1Failed(message);
      throw error;
    }
  }
  
  override cancel(): void {
    super.cancel();
    this.pipeline?.cancel();
  }
  
  private async handleSkipTranscription(
    config: TranscriptionStepConfig,
    context: StepExecutionContext
  ): Promise<TranscriptionStepResult> {
    this.emitProgress(context, 50, 'Reusing existing AI transcript...');
    
    // Load the existing transcript from the reuse source
    // This should be provided by the pipeline when context is set up
    const existingTranscript = await this.loadExistingTranscript(config.reuseFromEvaluationId!, context);
    
    if (!existingTranscript) {
      throw new Error('Cannot skip transcription: existing transcript not found');
    }
    
    logCall1Skipped(context.listingId, {
      existingTranscriptSegments: existingTranscript.segments?.length ?? 0,
      existingModel: existingTranscript.model,
      existingCreatedAt: existingTranscript.generatedAt,
    });
    
    this.emitProgress(context, 100, 'Reused existing transcript');
    
    return {
      skipped: true,
      reusedFrom: config.reuseFromEvaluationId,
      output: existingTranscript,
      prompt: '', // Not applicable for skipped
      variables: {},
    };
  }
  
  private async loadExistingTranscript(
    _evaluationId: string,
    context: StepExecutionContext
  ): Promise<TranscriptionStepResult['output'] | null> {
    // Load from the previous evaluation
    const { listingsRepository } = await import('@/services/storage');
    const { useAppStore } = await import('@/stores');
    
    const appId = useAppStore.getState().currentApp;
    const listing = await listingsRepository.getById(appId, context.listingId);
    
    if (!listing?.aiEval?.llmTranscript) {
      return null;
    }
    
    const eval$ = listing.aiEval;
    const llmTranscript = eval$.llmTranscript!;
    
    return {
      transcript: llmTranscript.fullTranscript,
      model: eval$.model,
      generatedAt: eval$.createdAt,
      segments: llmTranscript.segments,
      structuredData: eval$.judgeOutput?.structuredData,
    };
  }
  
  private buildVariableContext(
    context: StepExecutionContext,
    config: TranscriptionStepConfig
  ): VariableContext {
    // Build a minimal listing object for variable resolution
    const { useSettingsStore } = require('@/stores');
    const transcription = useSettingsStore.getState().transcription;
    
    return {
      listing: {
        id: context.listingId,
        appId: 'voice-rx',
        title: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'processing',
        sourceType: config.useSegments ? 'upload' : 'api',
        transcript: context.originalTranscript,
        structuredOutputReferences: [],
        structuredOutputs: [],
      },
      audioBlob: context.audioBlob,
      transcriptionPreferences: transcription,
    };
  }
  
  private parseResponse(
    text: string,
    parsed: unknown,
    useSegments: boolean
  ): { 
    transcript: string; 
    segments?: TranscriptSegment[]; 
    structuredData?: import('@/types').GeminiApiRx;
  } {
    let data = parsed;
    
    if (!data) {
      try {
        // Try to extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[0]);
        }
      } catch {
        throw new Error('Failed to parse transcription response as JSON');
      }
    }
    
    if (!data) {
      throw new Error('Invalid transcription response: no data');
    }
    
    const parsed$ = data as Record<string, unknown>;
    
    if (useSegments) {
      // Upload flow: expect segments array
      const segments = this.parseSegments(parsed$);
      const transcript = segments.map(s => `[${s.speaker}]: ${s.text}`).join('\n');
      
      return { transcript, segments };
    } else {
      // API flow: expect input + rx structure
      const transcript = String(parsed$.input || '');
      const structuredData = parsed$.rx as import('@/types').GeminiApiRx;
      
      return { transcript, structuredData };
    }
  }
  
  private parseSegments(data: Record<string, unknown>): TranscriptSegment[] {
    const rawSegments = data.segments as Array<Record<string, unknown>> | undefined;
    
    if (!rawSegments || !Array.isArray(rawSegments)) {
      throw new Error('Invalid transcription response: missing segments array');
    }
    
    return rawSegments.map((seg, index) => ({
      speaker: String(seg.speaker || 'Unknown'),
      text: String(seg.text || ''),
      startTime: String(seg.startTime ?? seg.start_time ?? index),
      endTime: String(seg.endTime ?? seg.end_time ?? index + 1),
      startSeconds: typeof seg.startTime === 'number' ? seg.startTime : undefined,
      endSeconds: typeof seg.endTime === 'number' ? seg.endTime : undefined,
    }));
  }
}
