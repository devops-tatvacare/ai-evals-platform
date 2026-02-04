import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListingsStore, useAppStore } from '@/stores';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { logListingCreated, logSourceTypeAssigned } from '@/services/logger';
import type { Listing, TranscriptData } from '@/types';
import type { ValidatedFile } from '../utils/fileValidation';
import { parseTranscriptFile, getAudioDuration, generateTitle } from '../utils/transcriptParser';

interface UploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
}

export function useFileUpload() {
  const navigate = useNavigate();
  const appId = useAppStore((state) => state.currentApp);
  const { addListing } = useListingsStore();
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
  });

  const processFiles = useCallback(async (files: ValidatedFile[]): Promise<Listing | null> => {
    setState({ isUploading: true, progress: 0, error: null });

    try {
      const audioFile = files.find((f) => f.category === 'audio');
      const transcriptFile = files.find((f) => f.category === 'transcript');

      // Audio file is required for the unified entry point
      if (!audioFile) {
        throw new Error('Please provide an audio file');
      }

      setState((s) => ({ ...s, progress: 10 }));

      // Process transcript if provided (for backward compatibility)
      let transcript: TranscriptData | undefined;
      let transcriptFileRef;

      if (transcriptFile) {
        setState((s) => ({ ...s, progress: 20 }));
        transcript = await parseTranscriptFile(transcriptFile.file);
        
        setState((s) => ({ ...s, progress: 40 }));
        const transcriptFileId = await filesRepository.save(transcriptFile.file);
        
        const ext = transcriptFile.file.name.slice(transcriptFile.file.name.lastIndexOf('.')).toLowerCase();
        transcriptFileRef = {
          id: transcriptFileId,
          name: transcriptFile.file.name,
          mimeType: transcriptFile.file.type || (ext === '.json' ? 'application/json' : 'text/plain'),
          size: transcriptFile.file.size,
          format: ext === '.json' ? 'json' : 'txt',
        } as const;
      }

      // Process audio file
      setState((s) => ({ ...s, progress: 60 }));
      
      let duration: number | undefined;
      try {
        duration = await getAudioDuration(audioFile.file);
      } catch {
        console.warn('Could not extract audio duration');
      }
      
      setState((s) => ({ ...s, progress: 80 }));
      const audioFileId = await filesRepository.save(audioFile.file);
      
      const audioFileRef = {
        id: audioFileId,
        name: audioFile.file.name,
        mimeType: audioFile.file.type || 'audio/wav',
        size: audioFile.file.size,
        duration,
      };

      setState((s) => ({ ...s, progress: 90 }));

      // Generate title from audio file
      const title = generateTitle(audioFile.file.name, transcript);

      // Create listing with 'pending' sourceType (assigned when user chooses action)
      // If transcript is provided during upload, set sourceType to 'upload' for backward compatibility
      const listing = await listingsRepository.create(appId, {
        title,
        status: 'draft',
        sourceType: transcriptFile ? 'upload' : 'pending',
        audioFile: audioFileRef,
        transcriptFile: transcriptFileRef,
        transcript,
        structuredOutputReferences: [],
        structuredOutputs: [],
      });

      // Log listing creation
      logListingCreated(listing.id, {
        audioFileName: audioFile.file.name,
        audioSize: audioFile.file.size,
        audioFormat: audioFile.file.type || 'audio/wav',
      });

      // Log source type assignment if transcript was provided
      if (transcriptFile) {
        logSourceTypeAssigned(listing.id, 'upload', 'add_transcript');
      }

      setState({ isUploading: false, progress: 100, error: null });
      
      // Update store
      addListing(appId, listing);
      
      return listing;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process files';
      setState({ isUploading: false, progress: 0, error: message });
      return null;
    }
  }, [appId, addListing]);

  const uploadFiles = useCallback(async (files: ValidatedFile[]) => {
    const listing = await processFiles(files);
    
    if (listing) {
      notificationService.success(`"${listing.title}" is ready for review`, 'Evaluation created');
      navigate(`/listing/${listing.id}`);
    } else if (state.error) {
      notificationService.error(state.error, 'Upload failed');
    }
  }, [processFiles, navigate, state.error]);

  return {
    ...state,
    uploadFiles,
  };
}
