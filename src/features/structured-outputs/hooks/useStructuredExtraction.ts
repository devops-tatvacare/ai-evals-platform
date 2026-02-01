import { useState, useCallback, useRef } from 'react';
import { llmProviderRegistry, withRetry } from '@/services/llm';
import { useSettingsStore, useTaskQueueStore } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import type { ILLMProvider, StructuredOutput, LLMResponse } from '@/types';
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
  const providerRef = useRef<ILLMProvider | null>(null);
  const cancelledRef = useRef(false);

  const { llm } = useSettingsStore();
  const { addTask, setTaskStatus, completeTask } = useTaskQueueStore();

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
      
      const provider = llmProviderRegistry.getProvider(llm.apiKey, llm.selectedModel);
      providerRef.current = provider;

      const prompt = buildPrompt(params);
      let response: LLMResponse;

      if (params.inputSource === 'audio' || params.inputSource === 'both') {
        if (!params.audioBlob || !params.audioMimeType) {
          throw new Error('Audio file is required for audio-based extraction');
        }
        response = await withRetry(() =>
          provider.generateContentWithAudio(
            prompt,
            params.audioBlob!,
            params.audioMimeType!
          )
        );
      } else {
        response = await withRetry(() => provider.generateContent(prompt));
      }

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      const result = parseJsonResponse(response.text);
      
      const structuredOutput: StructuredOutput = {
        id: generateId(),
        createdAt: new Date(),
        generatedAt: new Date(),
        prompt: params.prompt,
        promptType: params.promptType,
        inputSource: params.inputSource,
        model: llm.selectedModel,
        result,
        rawResponse: response.text,
        status: result ? 'completed' : 'failed',
        error: result ? undefined : 'Failed to parse JSON response',
        referenceId: params.referenceId,
      };

      // Save to listing
      const listing = await listingsRepository.getById(params.listingId);
      if (listing) {
        await listingsRepository.update(params.listingId, {
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
      providerRef.current = null;
    }
  }, [llm.apiKey, llm.selectedModel, addTask, setTaskStatus, completeTask, buildPrompt, parseJsonResponse]);

  const regenerate = useCallback(async (
    outputId: string,
    params: ExtractionParams
  ): Promise<StructuredOutput | null> => {
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
      
      const provider = llmProviderRegistry.getProvider(llm.apiKey, llm.selectedModel);
      providerRef.current = provider;

      const prompt = buildPrompt(params);
      let response: LLMResponse;

      if (params.inputSource === 'audio' || params.inputSource === 'both') {
        if (!params.audioBlob || !params.audioMimeType) {
          throw new Error('Audio file is required for audio-based extraction');
        }
        response = await withRetry(() =>
          provider.generateContentWithAudio(
            prompt,
            params.audioBlob!,
            params.audioMimeType!
          )
        );
      } else {
        response = await withRetry(() => provider.generateContent(prompt));
      }

      if (cancelledRef.current) {
        setTaskStatus(taskId, 'cancelled');
        return null;
      }

      const result = parseJsonResponse(response.text);
      
      // Update existing output
      const listing = await listingsRepository.getById(params.listingId);
      if (listing) {
        const updatedOutputs = listing.structuredOutputs.map(output => {
          if (output.id === outputId) {
            return {
              ...output,
              generatedAt: new Date(),
              model: llm.selectedModel,
              result,
              rawResponse: response.text,
              status: result ? 'completed' : 'failed',
              error: result ? undefined : 'Failed to parse JSON response',
            } as StructuredOutput;
          }
          return output;
        });

        await listingsRepository.update(params.listingId, {
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
      providerRef.current = null;
    }
  }, [llm.apiKey, llm.selectedModel, addTask, setTaskStatus, completeTask, buildPrompt, parseJsonResponse]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (providerRef.current) {
      providerRef.current.cancel();
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
