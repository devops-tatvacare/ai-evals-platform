import { useState, useEffect, useCallback, useRef } from 'react';
import { segmentPlayer } from '@/services/audio';
import { filesRepository } from '@/services/storage';

interface UseSegmentAudioOptions {
  audioFileId: string | undefined;
}

interface UseSegmentAudioReturn {
  isLoading: boolean;
  isReady: boolean;
  isPlaying: boolean;
  playingSegmentId: string | null;
  error: string | null;
  playSegment: (segmentId: string, startTime: string | number, endTime: string | number) => void;
  stopPlayback: () => void;
}

/**
 * Hook for managing segment audio playback
 * Handles loading audio and playing specific time ranges
 */
export function useSegmentAudio({ audioFileId }: UseSegmentAudioOptions): UseSegmentAudioReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const loadAttemptedRef = useRef(false);

  // Load audio when audioFileId changes
  useEffect(() => {
    if (!audioFileId) {
      setIsReady(false);
      return;
    }

    // Check if already loaded
    if (segmentPlayer.isLoaded(audioFileId)) {
      setIsReady(true);
      return;
    }

    // Prevent duplicate load attempts
    if (loadAttemptedRef.current) return;
    loadAttemptedRef.current = true;

    const loadAudio = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const storedFile = await filesRepository.getById(audioFileId);
        if (!storedFile) {
          throw new Error('Audio file not found');
        }

        await segmentPlayer.loadAudio(storedFile.data, audioFileId);
        setIsReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audio');
        setIsReady(false);
      } finally {
        setIsLoading(false);
      }
    };

    loadAudio();

    return () => {
      loadAttemptedRef.current = false;
    };
  }, [audioFileId]);

  const playSegment = useCallback((
    segmentId: string,
    startTime: string | number,
    endTime: string | number
  ) => {
    if (!isReady) return;

    setPlayingSegmentId(segmentId);
    setIsPlaying(true);

    segmentPlayer.play(startTime, endTime, {
      onEnded: () => {
        setIsPlaying(false);
        setPlayingSegmentId(null);
      },
      onError: (err) => {
        setError(err.message);
        setIsPlaying(false);
        setPlayingSegmentId(null);
      },
    });
  }, [isReady]);

  const stopPlayback = useCallback(() => {
    segmentPlayer.stop();
    setIsPlaying(false);
    setPlayingSegmentId(null);
  }, []);

  return {
    isLoading,
    isReady,
    isPlaying,
    playingSegmentId,
    error,
    playSegment,
    stopPlayback,
  };
}
