import { useState, useCallback, useRef } from 'react';

import { useTaskQueueStore } from '@/stores';
import { listingsRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { useCurrentAppId } from '@/hooks';
import type { StructuredOutput } from '@/types';
import { generateId } from '@/utils';
import { llmAssistApi } from '@/services/api/llmAssistApi';
import type { LLMProvider } from '@/services/api/aiSettingsApi';

interface ExtractionParams {
  listingId: string;
  prompt: string;
  promptType: 'freeform' | 'schema';
  inputSource: 'transcript' | 'audio' | 'both';
  provider: LLMProvider;
  model: string;
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

/**
 * Read a Blob as a raw base64 string (no `data:` prefix). The backend
 * `extract-structured` route accepts the base64 payload directly.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useStructuredExtraction(): UseStructuredExtractionReturn {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const appId = useCurrentAppId();
  const addTask = useTaskQueueStore((state) => state.addTask);
  const setTaskStatus = useTaskQueueStore((state) => state.setTaskStatus);
  const completeTask = useTaskQueueStore((state) => state.completeTask);

  const callBackend = useCallback(
    async (params: ExtractionParams) => {
      const audioBase64 =
        (params.inputSource === 'audio' || params.inputSource === 'both') && params.audioBlob
          ? await blobToBase64(params.audioBlob)
          : undefined;
      const audioMimeType = audioBase64 ? params.audioMimeType || 'audio/mpeg' : undefined;

      return llmAssistApi.extractStructured({
        provider: params.provider,
        model: params.model,
        prompt: params.prompt,
        promptType: params.promptType,
        inputSource: params.inputSource,
        transcript: params.transcript,
        audioBase64,
        audioMimeType,
      });
    },
    [],
  );

  const extract = useCallback(
    async (params: ExtractionParams): Promise<StructuredOutput | null> => {
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

        const response = await callBackend(params);
        if (cancelledRef.current) {
          setTaskStatus(taskId, 'cancelled');
          return null;
        }

        const result = response.status === 'completed' ? response.result : null;
        const structuredOutput: StructuredOutput = {
          id: generateId(),
          createdAt: new Date(),
          generatedAt: new Date(),
          prompt: params.prompt,
          promptType: params.promptType,
          inputSource: params.inputSource,
          model: params.model,
          result,
          rawResponse: result ? JSON.stringify(result) : '',
          status: result ? 'completed' : 'failed',
          error: response.error ?? (result ? undefined : 'Failed to parse JSON response'),
          referenceId: params.referenceId,
        };

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
      }
    },
    [appId, addTask, setTaskStatus, completeTask, callBackend],
  );

  const regenerate = useCallback(
    async (outputId: string, params: ExtractionParams): Promise<StructuredOutput | null> => {
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

        const response = await callBackend(params);
        if (cancelledRef.current) {
          setTaskStatus(taskId, 'cancelled');
          return null;
        }

        const result = response.status === 'completed' ? response.result : null;

        const listing = await listingsRepository.getById(appId, params.listingId);
        if (!listing) return null;

        const updatedOutputs = listing.structuredOutputs.map((output) => {
          if (output.id === outputId) {
            return {
              ...output,
              generatedAt: new Date(),
              model: params.model,
              result,
              rawResponse: result ? JSON.stringify(result) : '',
              status: result ? 'completed' : 'failed',
              error: response.error ?? (result ? undefined : 'Failed to parse JSON response'),
            } as StructuredOutput;
          }
          return output;
        });

        await listingsRepository.update(appId, params.listingId, {
          structuredOutputs: updatedOutputs,
        });

        const updatedOutput = updatedOutputs.find((o) => o.id === outputId);
        completeTask(taskId, updatedOutput);
        notificationService.success('Regeneration completed successfully');
        return updatedOutput || null;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Regeneration failed';
        setError(errorMessage);
        setTaskStatus(taskId, 'failed', errorMessage);
        notificationService.error(errorMessage, 'Regeneration failed');
        return null;
      } finally {
        setIsExtracting(false);
      }
    },
    [appId, addTask, setTaskStatus, completeTask, callBackend],
  );

  // The new backend round-trip can't be cancelled mid-flight (no streaming
  // pipeline anymore). Flip the local flag so any in-flight result is dropped
  // rather than persisted; the network request continues but its result is
  // discarded above.
  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return {
    isExtracting,
    error,
    extract,
    regenerate,
    cancel,
  };
}
