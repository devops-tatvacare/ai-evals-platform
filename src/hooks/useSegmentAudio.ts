import { useState, useEffect, useCallback, useRef } from 'react';
import { segmentPlayer, validateSegmentTimeRange, type SegmentPlayerEvent } from '@/services/audio';
import { filesRepository } from '@/services/storage';
import { logger } from '@/services/logger';

interface UseSegmentAudioOptions {
  audioFileId: string | undefined;
}

interface UseSegmentAudioReturn {
  /** True while audio is being fetched and decoded */
  isLoading: boolean;
  /** True when audio is loaded and ready to play */
  isReady: boolean;
  /** True when a segment is currently playing */
  isPlaying: boolean;
  /** ID of the currently playing segment, null if not playing */
  playingSegmentId: string | null;
  /** Error message if loading or playback failed */
  error: string | null;
  /** Duration of loaded audio in seconds, null if not loaded */
  audioDuration: number | null;
  /** 
   * Play a specific segment 
   * @param segmentId - Unique identifier for this segment (used to track which segment is playing)
   * @param startTime - Start time in seconds or "MM:SS" / "HH:MM:SS" format
   * @param endTime - End time in seconds or "MM:SS" / "HH:MM:SS" format
   * @returns true if playback started, false if validation failed
   */
  playSegment: (segmentId: string, startTime: string | number, endTime: string | number) => boolean;
  /** Stop current playback */
  stopPlayback: () => void;
  /** Check if a specific segment has valid timestamps for playback */
  canPlaySegment: (startTime: string | number | undefined, endTime: string | number | undefined) => boolean;
}

/**
 * Hook for managing segment audio playback
 * Uses event-based synchronization with singleton SegmentPlayer
 * Multiple components using this hook with the same audioFileId will share state correctly
 */
export function useSegmentAudio({ audioFileId }: UseSegmentAudioOptions): UseSegmentAudioReturn {
  // Core state
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  
  // Refs to avoid stale closures
  const audioFileIdRef = useRef(audioFileId);
  const isMountedRef = useRef(true);
  const hasInitiatedLoadRef = useRef<string | null>(null);

  // Keep audioFileId ref current
  useEffect(() => {
    audioFileIdRef.current = audioFileId;
  }, [audioFileId]);

  // Mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Subscribe to singleton events
  useEffect(() => {
    const handleEvent = (event: SegmentPlayerEvent) => {
      if (!isMountedRef.current) return;
      
      const currentAudioId = audioFileIdRef.current;
      
      switch (event.type) {
        case 'loading':
          if (event.audioId === currentAudioId) {
            setIsLoading(true);
            setError(null);
          }
          break;
          
        case 'loaded':
          if (event.audioId === currentAudioId) {
            setIsLoading(false);
            setIsReady(true);
            setAudioDuration(event.duration);
            setError(null);
          }
          break;
          
        case 'error':
          if (event.audioId === currentAudioId) {
            setIsLoading(false);
            setIsReady(false);
            setError(event.error);
          }
          break;
          
        case 'playStart':
          setIsPlaying(true);
          setPlayingSegmentId(event.segmentId);
          break;
          
        case 'playEnd':
          // Only clear if this was the segment we thought was playing
          setIsPlaying(false);
          setPlayingSegmentId(null);
          break;
          
        case 'disposed':
          setIsReady(false);
          setIsPlaying(false);
          setPlayingSegmentId(null);
          setAudioDuration(null);
          break;
      }
    };

    const unsubscribe = segmentPlayer.subscribe(handleEvent);
    return unsubscribe;
  }, []);

  // Sync with singleton state on audioFileId change
  useEffect(() => {
    if (!audioFileId) {
      // Reset state when no audio file
      setIsReady(false);
      setIsLoading(false);
      setError(null);
      setAudioDuration(null);
      setIsPlaying(false);
      setPlayingSegmentId(null);
      hasInitiatedLoadRef.current = null;
      return;
    }

    // Get current singleton state
    const state = segmentPlayer.getState();
    
    // If this audio is already loaded, sync immediately
    if (state.loadedAudioId === audioFileId) {
      setIsReady(true);
      setIsLoading(false);
      setAudioDuration(state.audioDuration);
      setError(null);
      
      // Sync playback state
      if (state.isPlaying) {
        setIsPlaying(true);
        setPlayingSegmentId(state.currentSegmentId);
      }
      return;
    }

    // If this audio is currently loading, just wait for events
    if (state.loadingAudioId === audioFileId) {
      setIsLoading(true);
      setIsReady(false);
      return;
    }

    // Need to load this audio - but only if we haven't already initiated
    if (hasInitiatedLoadRef.current === audioFileId) {
      return;
    }

    hasInitiatedLoadRef.current = audioFileId;
    const loadingForId = audioFileId;

    const loadAudio = async () => {
      if (!isMountedRef.current) return;
      
      logger.debug('useSegmentAudio: initiating load', { audioFileId: loadingForId });

      try {
        const blob = await filesRepository.getBlob(loadingForId);

        // Check if still relevant
        if (!isMountedRef.current || audioFileIdRef.current !== loadingForId) {
          logger.debug('useSegmentAudio: load cancelled - context changed', {
            loadingForId,
            currentId: audioFileIdRef.current
          });
          return;
        }

        if (!blob) {
          throw new Error('Audio file not found in storage');
        }

        await segmentPlayer.loadAudio(blob, loadingForId);
        // State will be updated via events
        
      } catch (err) {
        if (isMountedRef.current && audioFileIdRef.current === loadingForId) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to load audio';
          logger.error('useSegmentAudio: load failed', { audioFileId: loadingForId, error: errorMsg });
          setError(errorMsg);
          setIsReady(false);
          setIsLoading(false);
        }
      }
    };

    loadAudio();
  }, [audioFileId]);

  // Loading timeout — prevent indefinite spinner if decodeAudioData hangs
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        logger.warn('useSegmentAudio: loading timed out after 30s', { audioFileId: audioFileIdRef.current });
        setIsLoading(false);
        setError('Audio loading timed out');
      }
    }, 30_000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Check if segment timestamps are valid for playback
  const canPlaySegment = useCallback((
    startTime: string | number | undefined,
    endTime: string | number | undefined
  ): boolean => {
    const validation = validateSegmentTimeRange(startTime, endTime, audioDuration ?? undefined);
    return validation.valid;
  }, [audioDuration]);

  // Play a segment
  const playSegment = useCallback((
    segmentId: string,
    startTime: string | number,
    endTime: string | number
  ): boolean => {
    if (!isReady) {
      logger.warn('useSegmentAudio: playSegment called but audio not ready');
      return false;
    }

    // Pre-validate
    const validation = validateSegmentTimeRange(startTime, endTime, audioDuration ?? undefined);
    if (!validation.valid) {
      logger.warn('useSegmentAudio: playSegment skipped - invalid time range', {
        segmentId,
        error: validation.error,
        startTime,
        endTime,
      });
      setError(validation.error ?? 'Invalid time range');
      return false;
    }

    // Clear any previous error
    setError(null);

    segmentPlayer.play(segmentId, startTime, endTime, {
      onEnded: () => {
        // State updated via events
      },
      onError: (err) => {
        if (isMountedRef.current) {
          setError(err.message);
        }
      },
    });

    return true;
  }, [isReady, audioDuration]);

  // Stop playback
  const stopPlayback = useCallback(() => {
    segmentPlayer.stop();
    // State will be updated via events
  }, []);

  return {
    isLoading,
    isReady,
    isPlaying,
    playingSegmentId,
    error,
    audioDuration,
    playSegment,
    stopPlayback,
    canPlaySegment,
  };
}
