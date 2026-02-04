import { useState, useCallback, useRef } from 'react';
import { listingsRepository, filesRepository } from '@/services/storage';
import { notificationService } from '@/services/notifications';
import { logSourceTypeAssigned, logTranscriptSegmentDetection } from '@/services/logger';
import { useAppStore } from '@/stores';
import type { Listing, TranscriptData, TranscriptSegment } from '@/types';
import { parseJsonTranscript, parseTxtTranscript } from '../utils/transcriptParser';

interface TranscriptAddState {
  isAdding: boolean;
  error: string | null;
}

interface TranscriptAddResult {
  hasTimeSegments: boolean;
  segmentCount: number;
  speakerList: string[];
  transcript: TranscriptData;
}

/**
 * Detect if transcript has valid time segments
 */
function detectTimeSegments(transcript: TranscriptData): { hasTimeSegments: boolean; segmentCount: number } {
  if (!transcript.segments || transcript.segments.length === 0) {
    return { hasTimeSegments: false, segmentCount: 0 };
  }

  // Check if segments have valid time data
  const hasValidTimes = transcript.segments.some((seg: TranscriptSegment) => 
    seg.startSeconds !== undefined && 
    seg.endSeconds !== undefined &&
    seg.startSeconds >= 0 &&
    seg.endSeconds > seg.startSeconds
  );

  return {
    hasTimeSegments: hasValidTimes,
    segmentCount: transcript.segments.length,
  };
}

/**
 * Extract unique speakers from transcript
 */
function extractSpeakers(transcript: TranscriptData): string[] {
  const speakers = new Set<string>();
  
  // From speaker mapping
  Object.values(transcript.speakerMapping).forEach(speaker => {
    if (speaker) speakers.add(speaker);
  });
  
  // From segments
  transcript.segments.forEach(seg => {
    if (seg.speaker) speakers.add(seg.speaker);
  });
  
  return Array.from(speakers);
}

/**
 * Parse transcript file and detect its characteristics
 */
async function parseAndAnalyzeTranscript(file: File): Promise<TranscriptAddResult> {
  const content = await file.text();
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  
  let transcript: TranscriptData;
  
  if (ext === '.json') {
    transcript = parseJsonTranscript(content);
  } else if (ext === '.txt') {
    transcript = parseTxtTranscript(content);
  } else {
    throw new Error(`Unsupported transcript format: ${ext}. Please use .json or .txt files.`);
  }
  
  const { hasTimeSegments, segmentCount } = detectTimeSegments(transcript);
  const speakerList = extractSpeakers(transcript);
  
  return {
    hasTimeSegments,
    segmentCount,
    speakerList,
    transcript,
  };
}

export function useTranscriptAdd() {
  const appId = useAppStore((state) => state.currentApp);
  const [state, setState] = useState<TranscriptAddState>({
    isAdding: false,
    error: null,
  });
  
  // Hidden file input reference
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Callback to handle selected file
  const pendingResolve = useRef<((result: TranscriptAddResult | null) => void) | null>(null);
  const pendingListingRef = useRef<Listing | null>(null);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const listing = pendingListingRef.current;
    const resolve = pendingResolve.current;
    
    // Reset input for future use
    if (event.target) {
      event.target.value = '';
    }
    
    if (!file || !listing || !resolve) {
      resolve?.(null);
      return;
    }

    setState({ isAdding: true, error: null });

    try {
      // Parse and analyze the transcript
      const result = await parseAndAnalyzeTranscript(file);
      
      // Save transcript file to storage
      const transcriptFileId = await filesRepository.save(file);
      
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const transcriptFileRef = {
        id: transcriptFileId,
        name: file.name,
        mimeType: file.type || (ext === '.json' ? 'application/json' : 'text/plain'),
        size: file.size,
        format: ext === '.json' ? 'json' : 'txt',
      } as const;

      // Log segment detection results
      logTranscriptSegmentDetection(listing.id, {
        hasTimeSegments: result.hasTimeSegments,
        segmentCount: result.segmentCount,
        speakerCount: result.speakerList.length,
        format: ext === '.json' ? 'json' : 'txt',
      });

      // Update listing with transcript
      await listingsRepository.update(appId, listing.id, {
        transcript: result.transcript,
        transcriptFile: transcriptFileRef,
        sourceType: 'upload',
        updatedAt: new Date(),
        // Clear previous AI evaluation since data changed
        aiEval: undefined,
      });

      // Log source type assignment
      logSourceTypeAssigned(listing.id, 'upload', 'add_transcript');

      setState({ isAdding: false, error: null });
      
      notificationService.success(
        result.hasTimeSegments 
          ? `Added transcript with ${result.segmentCount} time segments`
          : 'Added transcript successfully',
        'Transcript Added'
      );

      resolve(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add transcript';
      setState({ isAdding: false, error: message });
      notificationService.error(message, 'Transcript Error');
      resolve(null);
    }
  }, [appId]);

  /**
   * Open file picker to add transcript to listing
   * Returns the analysis result or null if cancelled/failed
   */
  const addTranscriptToListing = useCallback((listing: Listing): Promise<TranscriptAddResult | null> => {
    return new Promise((resolve) => {
      // Store refs for use in file change handler
      pendingResolve.current = resolve;
      pendingListingRef.current = listing;
      
      // Create hidden file input if it doesn't exist
      if (!fileInputRef.current) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.json';
        input.style.display = 'none';
        input.addEventListener('change', handleFileChange as unknown as EventListener);
        // Handle cancel (no file selected)
        input.addEventListener('cancel', () => {
          resolve(null);
        });
        document.body.appendChild(input);
        fileInputRef.current = input;
      }
      
      // Trigger file picker
      fileInputRef.current.click();
    });
  }, [handleFileChange]);

  /**
   * Get updated listing after transcript add
   */
  const getUpdatedListing = useCallback(async (listingId: string): Promise<Listing | null> => {
    const result = await listingsRepository.getById(appId, listingId);
    return result ?? null;
  }, [appId]);

  return {
    ...state,
    addTranscriptToListing,
    getUpdatedListing,
  };
}
