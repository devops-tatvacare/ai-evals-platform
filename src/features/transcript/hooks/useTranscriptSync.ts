import { useState, useCallback, useRef, useMemo } from 'react';
import type { TranscriptSegment } from '@/types';

interface UseTranscriptSyncOptions {
  segments: TranscriptSegment[];
  debounceMs?: number;
}

/**
 * Binary search to find the segment containing the given time
 */
function findSegmentAtTime(segments: TranscriptSegment[], time: number): number | null {
  if (segments.length === 0) return null;

  // Handle edge cases
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];

  if (time < (firstSegment.startSeconds ?? 0)) return null;
  if (time > (lastSegment.endSeconds ?? 0)) return segments.length - 1;

  // Binary search
  let left = 0;
  let right = segments.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const segment = segments[mid];
    const start = segment.startSeconds ?? 0;
    const end = segment.endSeconds ?? 0;

    if (time >= start && time <= end) {
      return mid;
    }

    if (time < start) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  // If no exact match, find the closest segment
  // This handles gaps between segments
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const start = segment.startSeconds ?? 0;
    const end = segment.endSeconds ?? 0;
    
    if (time >= start && time <= end) {
      return i;
    }
    
    // Check if time is in a gap before this segment
    if (i > 0) {
      const prevEnd = segments[i - 1].endSeconds ?? 0;
      if (time > prevEnd && time < start) {
        // Return the segment we're closest to
        return time - prevEnd < start - time ? i - 1 : i;
      }
    }
  }

  return null;
}

export function useTranscriptSync({ segments, debounceMs = 50 }: UseTranscriptSyncOptions) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const lastUpdateRef = useRef(0);
  const pendingUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memoize segments with computed seconds
  const processedSegments = useMemo(() => segments, [segments]);

  // Update active segment based on time (debounced)
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;

    // Clear any pending update
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }

    // Debounce updates to meet 50ms latency budget
    if (timeSinceLastUpdate < debounceMs) {
      pendingUpdateRef.current = setTimeout(() => {
        const index = findSegmentAtTime(processedSegments, time);
        setActiveIndex(index);
        lastUpdateRef.current = Date.now();
      }, debounceMs - timeSinceLastUpdate);
    } else {
      const index = findSegmentAtTime(processedSegments, time);
      setActiveIndex(index);
      lastUpdateRef.current = now;
    }
  }, [processedSegments, debounceMs]);

  // Seek to a specific segment
  const seekToSegment = useCallback((index: number): number => {
    if (index < 0 || index >= processedSegments.length) {
      return currentTime;
    }

    const segment = processedSegments[index];
    const time = segment.startSeconds ?? 0;
    setActiveIndex(index);
    setCurrentTime(time);
    return time;
  }, [processedSegments, currentTime]);

  // Get time for a segment
  const getSegmentTime = useCallback((index: number): number => {
    if (index < 0 || index >= processedSegments.length) {
      return 0;
    }
    return processedSegments[index].startSeconds ?? 0;
  }, [processedSegments]);

  return {
    activeIndex,
    currentTime,
    handleTimeUpdate,
    seekToSegment,
    getSegmentTime,
    segments: processedSegments,
  };
}
