/**
 * Base Step Executor
 * Abstract base class for all step executors with common functionality
 */

import type { PipelineStep, StepValidationResult, StepExecutionContext } from '@/types';
import type { IStepExecutor, StepConfig, StepResult } from '../types';

/**
 * Abstract base class for step executors
 * Provides common functionality like cancellation and progress tracking
 */
export abstract class BaseStepExecutor<TConfig extends StepConfig, TResult extends StepResult>
  implements IStepExecutor<TConfig, TResult> {
  
  abstract readonly step: PipelineStep;
  
  protected isCancelled = false;
  
  /**
   * Validate the configuration before execution
   * Override in subclasses to add specific validation
   */
  validate(config: TConfig, _context: Partial<StepExecutionContext>): StepValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Base validation - subclasses can add more
    if (!config) {
      errors.push('Configuration is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  /**
   * Execute the step - must be implemented by subclasses
   */
  abstract execute(config: TConfig, context: StepExecutionContext): Promise<TResult>;
  
  /**
   * Cancel any in-progress execution
   */
  cancel(): void {
    this.isCancelled = true;
  }
  
  /**
   * Reset cancellation state (call before each execution)
   */
  protected resetCancellation(): void {
    this.isCancelled = false;
  }
  
  /**
   * Check if execution has been cancelled
   */
  protected checkCancellation(): void {
    if (this.isCancelled) {
      throw new CancellationError(`${this.step} step was cancelled`);
    }
  }
  
  /**
   * Helper to emit progress updates
   */
  protected emitProgress(
    context: StepExecutionContext,
    stepProgress: number,
    message: string,
    overallProgress?: number
  ): void {
    context.onProgress({
      currentStep: this.step,
      stepNumber: this.getStepNumber(),
      totalSteps: this.getTotalSteps(context),
      stepProgress,
      overallProgress: overallProgress ?? stepProgress,
      message,
    });
  }
  
  /**
   * Get the step number (1-based)
   */
  protected getStepNumber(): number {
    const stepOrder: PipelineStep[] = ['normalization', 'transcription', 'evaluation'];
    return stepOrder.indexOf(this.step) + 1;
  }
  
  /**
   * Get total number of steps based on context
   */
  protected getTotalSteps(context: StepExecutionContext): number {
    // Default: 2 steps (transcription + evaluation)
    // +1 if normalization is in previousStepResults (meaning it was executed)
    let total = 2;
    if (context.previousStepResults.normalization) {
      total = 3;
    }
    return total;
  }
}

/**
 * Error thrown when a step is cancelled
 */
export class CancellationError extends Error {
  readonly isCancellation = true;
  
  constructor(message: string) {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * Check if an error is a cancellation error
 */
export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError || 
    (error instanceof Error && (error as CancellationError).isCancellation === true);
}
