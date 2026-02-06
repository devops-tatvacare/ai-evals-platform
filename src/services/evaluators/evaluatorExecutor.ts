import { generateJsonSchema } from './schemaGenerator';
import { resolvePrompt } from '@/services/templates/variableResolver';
import { createLLMPipelineWithModel } from '@/services/llm';
import { filesRepository } from '@/services/storage';
import { saveEvaluatorRun } from './historyHelper';
import type { 
  EvaluatorDefinition, 
  EvaluatorRun, 
  Listing 
} from '@/types';

export interface ExecuteOptions {
  abortSignal?: AbortSignal;
}

export class EvaluatorExecutor {
  async execute(
    evaluator: EvaluatorDefinition,
    listing: Listing,
    options?: ExecuteOptions
  ): Promise<EvaluatorRun> {
    const run: EvaluatorRun = {
      id: crypto.randomUUID(),
      evaluatorId: evaluator.id,
      listingId: listing.id,
      status: 'processing',
      startedAt: new Date(),
    };
    
    let resolved: ReturnType<typeof resolvePrompt> | undefined;
    
    try {
      // Check if already aborted
      if (options?.abortSignal?.aborted) {
        throw new DOMException('Operation was cancelled', 'AbortError');
      }
      
      // 1. Load audio blob if available
      const audioBlob = listing.audioFile?.id 
        ? await filesRepository.getById(listing.audioFile.id)
        : undefined;
      
      // 2. Resolve prompt variables
      resolved = resolvePrompt(evaluator.prompt, {
        listing,
        audioBlob: audioBlob?.data,
      });
      
      // Check if we have audio
      const hasAudio = Array.from(resolved.resolvedVariables.values()).some(v => v instanceof Blob);

      console.log('[EvaluatorExecutor] Execution started', {
        evaluatorId: evaluator.id,
        evaluatorName: evaluator.name,
        listingId: listing.id,
        promptPreview: resolved.prompt.substring(0, 200) + '...',
        unresolvedVariables: resolved.unresolvedVariables,
        hasAudio,
      });
      
      // 3. Generate JSON schema from output definition
      const schema = generateJsonSchema(evaluator.outputSchema) as Record<string, unknown>;
      
      console.log('[EvaluatorExecutor] Generated schema', {
        schemaKeys: Object.keys(schema),
        outputSchemaFields: evaluator.outputSchema.length,
      });
      
      // 4. Get LLM pipeline with evaluator's model
      const pipeline = createLLMPipelineWithModel(evaluator.modelId);
      
      // Check if we have audio to pass
      console.log('[EvaluatorExecutor] Calling LLM pipeline', {
        hasAudio,
        modelId: evaluator.modelId,
        hasSchema: !!schema,
      });
      
      // Use the pipeline for invocation
      const response = await pipeline.invoke({
        prompt: resolved.prompt,
        context: {
          source: 'evaluator',
          sourceId: evaluator.id,
          metadata: { 
            listingId: listing.id, 
            evaluatorName: evaluator.name 
          },
        },
        output: {
          schema,
          format: 'json',
        },
        media: hasAudio && audioBlob?.data ? {
          audio: {
            blob: audioBlob.data,
            mimeType: 'audio/mpeg',
          },
        } : undefined,
        config: {
          temperature: 0.2, // Lower temperature for structured output
          abortSignal: options?.abortSignal,
        },
      });
      
      console.log('[EvaluatorExecutor] LLM response received', {
        hasText: !!response.output.text,
        textLength: response.output.text?.length || 0,
        textPreview: response.output.text?.substring(0, 100),
        hasParsed: !!response.output.parsed,
        durationMs: response.execution.durationMs,
      });
      
      // 5. Use already parsed output from pipeline
      let output;
      if (response.output.parsed) {
        output = response.output.parsed;
        console.log('[EvaluatorExecutor] Using pre-parsed output', {
          outputKeys: Object.keys(output || {}),
          outputPreview: JSON.stringify(output).substring(0, 200),
        });
      } else {
        // Fallback to manual parsing if needed
        try {
          output = typeof response.output.text === 'string' 
            ? JSON.parse(response.output.text) 
            : response.output.text;
            
          console.log('[EvaluatorExecutor] Output parsed manually', {
            outputKeys: Object.keys(output || {}),
            outputPreview: JSON.stringify(output).substring(0, 200),
          });
        } catch (parseError) {
          console.error('[EvaluatorExecutor] Failed to parse output', {
            error: parseError instanceof Error ? parseError.message : 'Unknown',
            rawText: response.output.text,
          });
          throw new Error(`Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
        }
      }
      
      console.log('[EvaluatorExecutor] Execution completed successfully', {
        evaluatorId: evaluator.id,
        outputKeys: Object.keys(output),
      });
      
      const completedRun = {
        ...run,
        status: 'completed' as const,
        output,
        rawRequest: resolved.prompt,
        rawResponse: response.output.text || JSON.stringify(output),
        completedAt: new Date(),
      };
      
      // Save to history (don't block on this)
      saveEvaluatorRun(evaluator, listing, completedRun).catch(error => {
        console.error('[EvaluatorExecutor] Failed to save run to history', {
          error: error instanceof Error ? error.message : 'Unknown',
          runId: completedRun.id,
        });
      });
      
      return completedRun;
      
    } catch (error) {
      console.error('[EvaluatorExecutor] Execution failed', {
        evaluatorId: evaluator.id,
        evaluatorName: evaluator.name,
        listingId: listing.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // Check if this was a cancellation
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      if (isAborted) {
        console.log('[EvaluatorExecutor] Execution was cancelled');
        return {
          ...run,
          status: 'failed' as const,
          error: 'Cancelled',
          completedAt: new Date(),
        };
      }
      
      // Provide user-friendly error messages
      let errorMessage = 'Unknown error occurred';
      
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        
        if (msg.includes('abort') || msg.includes('cancelled') || msg.includes('canceled')) {
          errorMessage = 'Operation was cancelled.';
        } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
          errorMessage = 'Network error: Unable to reach AI service. Please check your internet connection.';
        } else if (msg.includes('api key') || msg.includes('api_key') || msg.includes('unauthorized') || msg.includes('401')) {
          errorMessage = 'Authentication failed: Invalid or missing API key.';
        } else if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) {
          errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (msg.includes('timeout')) {
          errorMessage = 'Request timed out. The model may be overloaded.';
        } else {
          errorMessage = error.message;
        }
      }
      
      const failedRun = {
        ...run,
        status: 'failed' as const,
        error: errorMessage,
        rawRequest: resolved?.prompt,
        completedAt: new Date(),
      };
      
      // Save failed run to history (don't block on this)
      saveEvaluatorRun(evaluator, listing, failedRun).catch(error => {
        console.error('[EvaluatorExecutor] Failed to save failed run to history', {
          error: error instanceof Error ? error.message : 'Unknown',
          runId: failedRun.id,
        });
      });
      
      return failedRun;
    }
  }
}

export const evaluatorExecutor = new EvaluatorExecutor();
