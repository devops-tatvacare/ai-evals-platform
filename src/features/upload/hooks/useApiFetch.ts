import { useState, useCallback } from 'react';
import { transcribeWithGemini } from '@/services/api/geminiTranscription';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { useAppStore } from '@/stores';
import type { Listing, TranscriptData } from '@/types';

interface ApiFetchState {
  isFetching: boolean;
  error: string | null;
}

export function useApiFetch() {
  const appId = useAppStore((state) => state.currentApp);
  const [state, setState] = useState<ApiFetchState>({
    isFetching: false,
    error: null,
  });

  const fetchFromApi = useCallback(async (listing: Listing): Promise<Listing | null> => {
    if (!listing.audioFile) {
      notificationService.error('No audio file available');
      return null;
    }

    setState({ isFetching: true, error: null });

    try {
      // Load audio file from storage
      const storedFile = await filesRepository.getById(listing.audioFile.id);
      if (!storedFile) {
        throw new Error('Audio file not found in storage');
      }

      // Create File object from blob
      const audioFile = new File(
        [storedFile.data],
        listing.audioFile.name,
        { type: listing.audioFile.mimeType }
      );

      // Call Gemini API
      const apiResponse = await transcribeWithGemini({ file: audioFile });

      if (!apiResponse.success) {
        throw new Error('API returned unsuccessful response');
      }

      // Convert API transcript to TranscriptData format (flat, no segments)
      const transcript: TranscriptData = {
        formatVersion: '2.0-api',
        generatedAt: new Date().toISOString(),
        metadata: {
          recordingId: listing.id,
          jobId: `api-${Date.now()}`,
          processedAt: new Date().toISOString(),
        },
        speakerMapping: {},
        segments: [],
        fullTranscript: apiResponse.input,
      };

      // Update listing with API response and transcript
      const updatedListing: Listing = {
        ...listing,
        apiResponse,
        transcript,
        updatedAt: new Date(),
        aiEval: undefined,
      };

      await listingsRepository.update(appId, listing.id, {
        apiResponse,
        transcript,
        updatedAt: new Date(),
        aiEval: undefined,
      });

      setState({ isFetching: false, error: null });
      notificationService.success('API transcript fetched successfully');

      return updatedListing;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch from API';
      setState({ isFetching: false, error: message });
      notificationService.error(message, 'API fetch failed');
      return null;
    }
  }, [appId]);

  const refetchFromApi = useCallback(async (listing: Listing): Promise<Listing | null> => {
    return fetchFromApi(listing);
  }, [fetchFromApi]);

  return {
    ...state,
    fetchFromApi,
    refetchFromApi,
  };
}
