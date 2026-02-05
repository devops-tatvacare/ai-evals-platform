import { generateJsonSchema } from './schemaGenerator';
import { resolvePrompt } from '@/services/templates/variableResolver';
import { llmProviderRegistry } from '@/services/llm';
import { filesRepository } from '@/services/storage';
import { useSettingsStore } from '@/stores';
import { saveEvaluatorRun } from './historyHelper';
import type { 
  EvaluatorDefinition, 
  EvaluatorRun, 
  Listing 
} from '@/types';

export class EvaluatorExecutor {
  async execute(
    evaluator: EvaluatorDefinition,
    listing: Listing
  ): Promise<EvaluatorRun> {
    const run: EvaluatorRun = {
      id: crypto.randomUUID(),
      evaluatorId: evaluator.id,
      listingId: listing.id,
      status: 'processing',
      startedAt: new Date(),
    };
    
    try {
      // 1. Load audio blob if available
      const audioBlob = listing.audioFile?.id 
        ? await filesRepository.getById(listing.audioFile.id)
        : undefined;
      
      // 2. Resolve prompt variables
      const resolved = resolvePrompt(evaluator.prompt, {
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
      
      // 4. Get LLM provider from settings
      const settings = useSettingsStore.getState();
      const provider = llmProviderRegistry.getProvider(
        settings.llm.apiKey,
        evaluator.modelId
      );
      
      // Check if we have audio to pass
      let response;
      
      console.log('[EvaluatorExecutor] Calling LLM provider', {
        hasAudio,
        modelId: evaluator.modelId,
        hasSchema: !!schema,
      });
      
      if (hasAudio && audioBlob?.data) {
        // Use audio-enabled method
        response = await provider.generateContentWithAudio(
          resolved.prompt,
          audioBlob.data,
          'audio/mpeg',
          {
            responseSchema: schema,
            temperature: 0.2, // Lower temperature for structured output
          }
        );
      } else {
        // Text-only method
        response = await provider.generateContent(resolved.prompt, {
          responseSchema: schema,
          temperature: 0.2, // Lower temperature for structured output
        });
      }
      
      console.log('[EvaluatorExecutor] LLM response received', {
        hasText: !!response.text,
        textLength: response.text?.length || 0,
        textPreview: response.text?.substring(0, 100),
        hasUsage: !!response.usage,
      });
      
      // 5. Parse structured output
      let output;
      try {
        output = typeof response.text === 'string' 
          ? JSON.parse(response.text) 
          : response.text;
          
        console.log('[EvaluatorExecutor] Output parsed successfully', {
          outputKeys: Object.keys(output || {}),
          outputPreview: JSON.stringify(output).substring(0, 200),
        });
      } catch (parseError) {
        console.error('[EvaluatorExecutor] Failed to parse output', {
          error: parseError instanceof Error ? parseError.message : 'Unknown',
          rawText: response.text,
        });
        throw new Error(`Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
      }
      
      console.log('[EvaluatorExecutor] Execution completed successfully', {
        evaluatorId: evaluator.id,
        outputKeys: Object.keys(output),
      });
      
      const completedRun = {
        ...run,
        status: 'completed' as const,
        output,
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
      
      // Provide user-friendly error messages
      let errorMessage = 'Unknown error occurred';
      
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
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
