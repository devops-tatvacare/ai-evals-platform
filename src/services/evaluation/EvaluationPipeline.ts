/**
 * Evaluation Pipeline
 * Orchestrates the execution of evaluation steps in sequence
 */

import type {
  EvaluationConfig,
  EvaluationProgressCallback,
  PipelineStep,
  StepExecutionContext,
  TranscriptData,
  AIEvaluationV2,
} from '@/types';
import type { PipelineState, PipelineResult, PipelineOptions } from './types';
import { 
  NormalizationExecutor, 
  TranscriptionExecutor, 
  EvaluationExecutor,
  isCancellationError,
} from './stepExecutors';
import { generateId } from '@/utils';
import { filesRepository, listingsRepository } from '@/services/storage';
import { useAppStore } from '@/stores';

/**
 * Main evaluation pipeline class
 * Coordinates execution of normalization, transcription, and evaluation steps
 */
export class EvaluationPipeline {
  private config: EvaluationConfig;
  private listingId: string;
  private state: PipelineState;
  private progressCallback?: EvaluationProgressCallback;
  
  // Step executors
  private normalizationExecutor: NormalizationExecutor;
  private transcriptionExecutor: TranscriptionExecutor;
  private evaluationExecutor: EvaluationExecutor;
  
  // Cached data
  private audioBlob?: Blob;
  private mimeType?: string;
  private originalTranscript?: TranscriptData;
  private apiResponse?: unknown;
  
  constructor(config: EvaluationConfig, listingId: string) {
    this.config = config;
    this.listingId = listingId;
    
    this.state = {
      currentStep: null,
      stepNumber: 0,
      totalSteps: this.calculateTotalSteps(),
      isCancelled: false,
      abortController: new AbortController(),
    };
    
    // Initialize executors
    this.normalizationExecutor = new NormalizationExecutor();
    this.transcriptionExecutor = new TranscriptionExecutor();
    this.evaluationExecutor = new EvaluationExecutor();
  }
  
  /**
   * Set progress callback
   */
  onProgress(callback: EvaluationProgressCallback): void {
    this.progressCallback = callback;
  }
  
  /**
   * Execute the evaluation pipeline
   */
  async execute(options?: PipelineOptions): Promise<PipelineResult> {
    if (options?.onProgress) {
      this.progressCallback = options.onProgress;
    }
    
    const result: PipelineResult = {
      success: false,
    };
    
    try {
      // Load required data
      await this.loadListingData();
      
      // Build execution context
      const baseContext = this.buildBaseContext();
      
      // Step 1: Normalization (if enabled)
      if (this.config.prerequisites.normalizationEnabled) {
        this.updateState('normalization');
        
        result.normalization = await this.normalizationExecutor.execute(
          this.config.prerequisites,
          {
            ...baseContext,
            previousStepResults: {},
          }
        );
        
        this.checkCancellation();
      }
      
      // Step 2: Transcription
      this.updateState('transcription');
      
      result.transcription = await this.transcriptionExecutor.execute(
        this.config.transcription,
        {
          ...baseContext,
          previousStepResults: {
            normalization: result.normalization,
          },
        }
      );
      
      this.checkCancellation();
      
      // Normalize judge transcript if needed (after transcription)
      if (result.normalization && 
          (this.config.prerequisites.normalizationTarget === 'judge' || 
           this.config.prerequisites.normalizationTarget === 'both') &&
          result.transcription.output.segments) {
        
        const judgeTranscript: TranscriptData = {
          formatVersion: '1.0',
          generatedAt: result.transcription.output.generatedAt.toISOString(),
          metadata: {
            recordingId: 'ai-generated',
            jobId: `eval-${Date.now()}`,
            processedAt: new Date().toISOString(),
          },
          speakerMapping: {},
          segments: result.transcription.output.segments,
          fullTranscript: result.transcription.output.transcript,
        };
        
        result.normalization.normalizedJudge = await this.normalizationExecutor.normalizeJudgeTranscript(
          judgeTranscript,
          result.normalization,
          this.state.abortController.signal
        );
      }
      
      // Step 3: Evaluation
      this.updateState('evaluation');
      
      result.evaluation = await this.evaluationExecutor.execute(
        this.config.evaluation,
        {
          ...baseContext,
          previousStepResults: {
            normalization: result.normalization,
            transcription: result.transcription,
          },
        }
      );
      
      result.success = true;
      
    } catch (error) {
      if (isCancellationError(error)) {
        result.error = 'Evaluation was cancelled';
        result.failedAt = this.state.currentStep ?? undefined;
      } else {
        result.error = error instanceof Error ? error.message : 'Unknown error';
        result.failedAt = this.state.currentStep ?? undefined;
      }
    }
    
    return result;
  }
  
  /**
   * Cancel the pipeline execution
   */
  cancel(): void {
    this.state.isCancelled = true;
    this.state.abortController.abort();
    
    // Cancel all executors
    this.normalizationExecutor.cancel();
    this.transcriptionExecutor.cancel();
    this.evaluationExecutor.cancel();
  }
  
  /**
   * Convert pipeline result to AIEvaluationV2 format
   */
  buildEvaluationResult(result: PipelineResult): AIEvaluationV2 {
    const evaluation: AIEvaluationV2 = {
      id: generateId(),
      createdAt: new Date(),
      model: this.config.transcription.model, // Primary model
      status: result.success ? 'completed' : 'failed',
      config: this.config,
      normalization: result.normalization,
      transcription: result.transcription,
      evaluation: result.evaluation,
      error: result.error,
      failedAt: result.failedAt,
      
      // Build legacy fields for backward compatibility
      prompts: {
        transcription: this.config.transcription.prompt,
        evaluation: this.config.evaluation.prompt,
      },
      schemas: {
        transcription: this.config.transcription.schema,
        evaluation: this.config.evaluation.schema,
      },
    };
    
    // Map to legacy fields for UI compatibility
    if (result.transcription) {
      if (result.transcription.output.segments) {
        // Upload flow
        evaluation.llmTranscript = {
          formatVersion: '1.0',
          generatedAt: result.transcription.output.generatedAt.toISOString(),
          metadata: {
            recordingId: 'ai-generated',
            jobId: `eval-${Date.now()}`,
            processedAt: new Date().toISOString(),
          },
          speakerMapping: {},
          segments: result.transcription.output.segments,
          fullTranscript: result.transcription.output.transcript,
        };
      } else if (result.transcription.output.structuredData) {
        // API flow
        evaluation.judgeOutput = {
          transcript: result.transcription.output.transcript,
          structuredData: result.transcription.output.structuredData,
        };
      }
    }
    
    if (result.evaluation) {
      if (result.evaluation.output.segmentCritiques) {
        // Upload flow
        evaluation.critique = {
          segments: result.evaluation.output.segmentCritiques,
          overallAssessment: result.evaluation.output.overallAssessment,
          assessmentReferences: result.evaluation.output.assessmentReferences,
          statistics: result.evaluation.output.statistics,
          generatedAt: result.evaluation.output.generatedAt,
          model: result.evaluation.output.model,
        };
      } else if (result.evaluation.output.transcriptComparison || result.evaluation.output.structuredComparison) {
        // API flow
        evaluation.apiCritique = {
          transcriptComparison: result.evaluation.output.transcriptComparison!,
          structuredComparison: result.evaluation.output.structuredComparison!,
          overallAssessment: result.evaluation.output.overallAssessment,
          generatedAt: result.evaluation.output.generatedAt,
          model: result.evaluation.output.model,
        };
      }
    }
    
    if (result.normalization?.normalizedOriginal) {
      evaluation.normalizedOriginal = result.normalization.normalizedOriginal.transcript;
      evaluation.normalizationMeta = {
        enabled: this.config.prerequisites?.normalizationEnabled || false,
        sourceScript: result.normalization.sourceScript,
        targetScript: result.normalization.targetScript,
        normalizedAt: result.normalization.normalizedAt,
      };
    }
    
    return evaluation;
  }
  
  private calculateTotalSteps(): number {
    let total = 2; // Transcription + Evaluation always run
    
    if (this.config.prerequisites.normalizationEnabled) {
      total++;
    }
    
    return total;
  }
  
  private updateState(step: PipelineStep): void {
    this.state.currentStep = step;
    this.state.stepNumber++;
  }
  
  private checkCancellation(): void {
    if (this.state.isCancelled) {
      throw new Error('Pipeline was cancelled');
    }
  }
  
  private async loadListingData(): Promise<void> {
    const appId = useAppStore.getState().currentApp;
    const listing = await listingsRepository.getById(appId, this.listingId);
    
    if (!listing) {
      throw new Error('Listing not found');
    }
    
    // Load audio file
    if (listing.audioFile) {
      const blob = await filesRepository.getBlob(listing.audioFile.id);
      if (!blob) {
        throw new Error('Audio file not found in storage');
      }
      this.audioBlob = blob;
      this.mimeType = listing.audioFile.mimeType;
    } else {
      throw new Error('No audio file available for this listing');
    }
    
    // Load transcript if available
    if (listing.transcript) {
      this.originalTranscript = listing.transcript;
    } else if (listing.apiResponse?.input && this.config.prerequisites.normalizationEnabled) {
      // API flow: wrap the plain string transcript as TranscriptData for normalization
      this.originalTranscript = {
        formatVersion: '1.0',
        generatedAt: new Date().toISOString(),
        metadata: {
          recordingId: listing.id,
          jobId: `api-${listing.id}`,
          processedAt: new Date().toISOString(),
        },
        speakerMapping: {},
        segments: [{
          speaker: 'Speaker',
          text: listing.apiResponse.input,
          startTime: '00:00:00',
          endTime: '00:00:00',
        }],
        fullTranscript: listing.apiResponse.input,
      };
    }
    
    // Load API response if available
    if (listing.apiResponse) {
      this.apiResponse = listing.apiResponse;
    }
  }
  
  private buildBaseContext(): Omit<StepExecutionContext, 'previousStepResults'> {
    return {
      listingId: this.listingId,
      audioBlob: this.audioBlob!,
      mimeType: this.mimeType!,
      originalTranscript: this.originalTranscript,
      apiResponse: this.apiResponse,
      abortSignal: this.state.abortController.signal,
      onProgress: (progress) => {
        // Merge step progress with overall progress
        const overallProgress = this.calculateOverallProgress(
          this.state.stepNumber,
          progress.stepProgress
        );
        
        this.progressCallback?.({
          ...progress,
          stepNumber: this.state.stepNumber,
          totalSteps: this.state.totalSteps,
          overallProgress,
        });
      },
    };
  }
  
  private calculateOverallProgress(stepNumber: number, stepProgress: number): number {
    const stepWeight = 100 / this.state.totalSteps;
    const completedWeight = (stepNumber - 1) * stepWeight;
    const currentWeight = (stepProgress / 100) * stepWeight;
    return Math.round(completedWeight + currentWeight);
  }
}

/**
 * Create and execute an evaluation pipeline
 */
export async function runEvaluationPipeline(
  config: EvaluationConfig,
  listingId: string,
  options?: PipelineOptions
): Promise<AIEvaluationV2> {
  const pipeline = new EvaluationPipeline(config, listingId);
  
  if (options?.onProgress) {
    pipeline.onProgress(options.onProgress);
  }
  
  const result = await pipeline.execute();
  
  return pipeline.buildEvaluationResult(result);
}
