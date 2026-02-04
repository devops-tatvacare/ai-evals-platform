import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListingsStore, useAppStore } from '@/stores';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import type { Listing } from '@/types';
import { getAudioDuration, generateTitle } from '../utils/transcriptParser';

interface ApiUploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
}

export function useApiUpload() {
  const navigate = useNavigate();
  const appId = useAppStore((state) => state.currentApp);
  const { addListing } = useListingsStore();
  const [state, setState] = useState<ApiUploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  const processAudioFile = useCallback(async (file: File): Promise<Listing | null> => {
    setState({ isUploading: true, progress: 0, error: null });

    try {
      // Validate it's an audio file
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3|webm|m4a|ogg)$/i)) {
        throw new Error('Please provide an audio file');
      }

      setState((s) => ({ ...s, progress: 20 }));

      // Get audio duration
      let duration: number | undefined;
      try {
        duration = await getAudioDuration(file);
      } catch {
        console.warn('Could not extract audio duration');
      }

      setState((s) => ({ ...s, progress: 50 }));

      // Store audio file
      const audioFileId = await filesRepository.save(file);

      const audioFileRef = {
        id: audioFileId,
        name: file.name,
        mimeType: file.type || 'audio/wav',
        size: file.size,
        duration,
      };

      setState((s) => ({ ...s, progress: 80 }));

      // Generate title from filename
      const title = generateTitle(file.name);

      // Create listing with sourceType: 'api'
      const listing = await listingsRepository.create(appId, {
        title,
        status: 'draft',
        sourceType: 'api',
        audioFile: audioFileRef,
        structuredOutputReferences: [],
        structuredOutputs: [],
      });

      setState({ isUploading: false, progress: 100, error: null });

      // Update store
      addListing(appId, listing);

      return listing;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process audio file';
      setState({ isUploading: false, progress: 0, error: message });
      return null;
    }
  }, [appId, addListing]);

  const uploadAudioFile = useCallback(async (file: File) => {
    const listing = await processAudioFile(file);

    if (listing) {
      notificationService.success(`"${listing.title}" created. Ready to fetch from API.`, 'Listing created');
      navigate(`/listing/${listing.id}`);
    } else if (state.error) {
      notificationService.error(state.error, 'Upload failed');
    }
  }, [processAudioFile, navigate, state.error]);

  return {
    ...state,
    uploadAudioFile,
  };
}
