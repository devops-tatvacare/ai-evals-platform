import { useState, useCallback, useRef } from 'react';
import { createLLMPipeline, type LLMInvocationPipeline } from '@/services/llm';
import { useSettingsStore, useTaskQueueStore } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { useCurrentAppId } from '@/hooks';
import type { StructuredOutput } from '@/types';
import { generateId } from '@/utils';

interface ExtractionParams {
  listingId: string;
  prompt: string;
  promptType: 'freeform' | 'schema';
  inputSource: 'transcript' | 'audio' | 'both';
  transcript?: string;
  audioBlob?: Blob;
  audioMimeType?: string;
  referenceId?: string;
  existingOutputId?: string;
}

interface UseStructuredExtractionReturn {
  isExtracting: boolean;
  error: string | null;
  extract: (params: ExtractionParams) => Promise<StructuredOutput | null>;
  regenerate: (outputId: string, params: ExtractionParams) => Promise<StructuredOutput | null>;
  cancel: () => void;
}

export function useStructuredExtraction(): UseStructuredExtractionReturn {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pipelineRef = useRef<LLMInvocationPipeline | null>(null);
  const cancelledRef = useRef(false);

  const appId = useCurrentAppId();
  const addTask = useTaskQueueStore((state) => state.addTask);
  const setTaskStatus = useTaskQueueStore((state) => state.setTaskStatus);
  const completeTask = useTaskQueueStore((state) => state.completeTask);

  const buildPrompt = useCallback((params: ExtractionParams): string => {
    const basePrompt = params.promptType === 'schema'
      ? `Extract structured data from the following content according to this JSON schema:\n\n${params.prompt}\n\nRespond ONLY with valid JSON that matches the schema. Do not include any explanation or markdown formatting.\n\n`
      : `${params.prompt}\n\nRespond ONLY with valid JSON. Do not include any explanation or markdown formatting.\n\n`;

    if (params.inputSource === 'transcript' || params.inputSource === 'both') {
      return `${basePrompt}Content:\n${params.transcript || ''}`;
    }
    
    return basePrompt;
  }, []);

  const parseJsonResponse = useCallback((text: string): object | null => {
    // Try to extract JSON from the response
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      const firstNewline = jsonText.indexOf('\n');
      const lastBackticks = jsonText.lastIndexOf('```');
      if (firstNewline !== -1 && lastBackticks > firstNewline) {
        jsonText = jsonText.slice(firstNewline + 1, lastBackticks).trim();
      }
    }
    
    try {
      return JSON.parse(jsonText);
    } catch {
      // Try to find JSON object in the text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }, []);

  const extract = useCallback(async (params: ExtractionParams): Promise<StructuredOutput | null> => {
    // Get fresh values from store each time extract is called
    const llm = useSettingsStore.getState().llm;
    
    if (!llm.apiKey) {
      setError('API key not configured. Go to Settings to add your API key.');
      return null;
    }

    setIsExtracting(true);
    setError(null);
    cancelledRef.current = false;

    const taskId = addTask({
      listingId: params.listingId,
      type: 'structured_output',
      prompt: params.prompt,
      inputSource: params.inputSource,
    });

    try {
      setTaskStatus(taskId, 'processing');
      
      const pipeline = createLLMPipeline();
      pipelineRef.current = pipeline;

      const prompt = buildPrompt(params);
      
      const response = await pipeline.invoke({
        prompt,
        context: {
          source: 'structured-extraction',
          sourceId: params.listingId,
        },
        output: {
          format: 'json',
        },
        media: (params.inputSource === 'audio' || params.inputSource === 'both') && params.audioBlob ? {
          audio: {
            blob: params.audioBlob,
            mimeType: params.audioMimeType || 'audio/mpeg',
          },
        } : undefined,
      });

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // Use pre-parsed output or fallback to manual parsing
      const result = response.output.parsed ?? parseJsonResponse(response.output.text);
      
      const structuredOutput: StructuredOutput = {
        id: generateId(),
        createdAt: new Date(),
        generatedAt: new Date(),
        prompt: params.prompt,
        promptType: params.promptType,
        inputSource: params.inputSource,
        model: llm.selectedModel,
        result,
        rawResponse: response.output.text,
        status: result ? 'completed' : 'failed',
        error: result ? undefined : 'Failed to parse JSON response',
        referenceId: params.referenceId,
      };

      // Save to listing
      const listing = await listingsRepository.getById(appId, params.listingId);
      if (listing) {
        await listingsRepository.update(appId, params.listingId, {
          structuredOutputs: [...listing.structuredOutputs, structuredOutput],
        });
      }

      completeTask(taskId, structuredOutput);
      notificationService.success('Extraction completed successfully');
      
      return structuredOutput;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Extraction failed';
      setError(errorMessage);
      setTaskStatus(taskId, 'failed', errorMessage);
      notificationService.error(errorMessage, 'Extraction failed');
      return null;
    } finally {
      setIsExtracting(false);
      pipelineRef.current = null;
    }
  }, [appId, addTask, setTaskStatus, completeTask, buildPrompt, parseJsonResponse]);

  const regenerate = useCallback(async (
    outputId: string,
    params: ExtractionParams
  ): Promise<StructuredOutput | null> => {
    // Get fresh values from store each time regenerate is called
    const llm = useSettingsStore.getState().llm;
    
    if (!llm.apiKey) {
      setError('API key not configured. Go to Settings to add your API key.');
      return null;
    }

    setIsExtracting(true);
    setError(null);
    cancelledRef.current = false;

    const taskId = addTask({
      listingId: params.listingId,
      type: 'structured_output',
      prompt: params.prompt,
      inputSource: params.inputSource,
    });

    try {
      setTaskStatus(taskId, 'processing');
      
      const pipeline = createLLMPipeline();
      pipelineRef.current = pipeline;

      const prompt = buildPrompt(params);
      
      const response = await pipeline.invoke({
        prompt,
        context: {
          source: 'structured-extraction',
          sourceId: params.listingId,
        },
        output: {
          format: 'json',
        },
        media: (params.inputSource === 'audio' || params.inputSource === 'both') && params.audioBlob ? {
          audio: {
            blob: params.audioBlob,
            mimeType: params.audioMimeType || 'audio/mpeg',
          },
        } : undefined,
      });

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      // Use pre-parsed output or fallback to manual parsing
      const result = response.output.parsed ?? parseJsonResponse(response.output.text);
      
      // Update existing output
      const listing = await listingsRepository.getById(appId, params.listingId);
      if (listing) {
        const updatedOutputs = listing.structuredOutputs.map(output => {
          if (output.id === outputId) {
            return {
              ...output,
              generatedAt: new Date(),
              model: llm.selectedModel,
              result,
              rawResponse: response.output.text,
              status: result ? 'completed' : 'failed',
              error: result ? undefined : 'Failed to parse JSON response',
            } as StructuredOutput;
          }
          return output;
        });

        await listingsRepository.update(appId, params.listingId, {
          structuredOutputs: updatedOutputs,
        });

        const updatedOutput = updatedOutputs.find(o => o.id === outputId);
        
        completeTask(taskId, updatedOutput);
        notificationService.success('Regeneration completed successfully');
        
        return updatedOutput || null;
      }

      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Regeneration failed';
      setError(errorMessage);
      setTaskStatus(taskId, 'failed', errorMessage);
      notificationService.error(errorMessage, 'Regeneration failed');
      return null;
    } finally {
      setIsExtracting(false);
      pipelineRef.current = null;
    }
  }, [appId, addTask, setTaskStatus, completeTask, buildPrompt, parseJsonResponse]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (pipelineRef.current) {
      pipelineRef.current.cancel();
    }
  }, []);

  return {
    isExtracting,
    error,
    extract,
    regenerate,
    cancel,
  };
}
