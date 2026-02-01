/**
 * Segment Audio Player
 * AudioContext-based service for sample-accurate segment playback
 * Uses event emitter pattern for state synchronization across components
 */

import { logger } from '@/services/logger';

export interface SegmentPlaybackOptions {
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

/** Events emitted by SegmentPlayer for state synchronization */
export type SegmentPlayerEvent = 
  | { type: 'loading'; audioId: string }
  | { type: 'loaded'; audioId: string; duration: number }
  | { type: 'error'; audioId: string; error: string }
  | { type: 'playStart'; segmentId: string }
  | { type: 'playEnd'; segmentId: string }
  | { type: 'disposed' };

export type SegmentPlayerEventListener = (event: SegmentPlayerEvent) => void;

/** Result of parsing a time value */
export interface ParsedTime {
  seconds: number;
  valid: boolean;
  original: string | number | undefined;
}

/**
 * Parse time string (HH:MM:SS or MM:SS) to seconds
 * Returns structured result with validity flag
 */
export function parseTimeToSeconds(time: string | number | undefined): number {
  const result = parseTimeWithValidation(time);
  return result.seconds;
}

/**
 * Parse time with validation info
 * Use this when you need to know if the time was actually valid
 */
export function parseTimeWithValidation(time: string | number | undefined): ParsedTime {
  if (time === undefined || time === null) {
    return { seconds: 0, valid: false, original: time };
  }
  
  if (typeof time === 'number') {
    const valid = !isNaN(time) && isFinite(time) && time >= 0;
    return { seconds: valid ? time : 0, valid, original: time };
  }
  
  const str = String(time).trim();
  if (!str) {
    return { seconds: 0, valid: false, original: time };
  }
  
  const parts = str.split(':').map(Number);
  
  if (parts.length === 3) {
    // HH:MM:SS
    const [h, m, s] = parts;
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
      return { seconds: h * 3600 + m * 60 + s, valid: true, original: time };
    }
  } else if (parts.length === 2) {
    // MM:SS
    const [m, s] = parts;
    if (!isNaN(m) && !isNaN(s)) {
      return { seconds: m * 60 + s, valid: true, original: time };
    }
  } else if (parts.length === 1) {
    const parsed = parseFloat(str);
    if (!isNaN(parsed) && isFinite(parsed) && parsed >= 0) {
      return { seconds: parsed, valid: true, original: time };
    }
  }
  
  return { seconds: 0, valid: false, original: time };
}

/**
 * Validates segment time range before playback
 * Returns error message if invalid, null if valid
 */
export function validateSegmentTimeRange(
  startTime: string | number | undefined,
  endTime: string | number | undefined,
  audioDuration?: number
): { valid: boolean; error?: string; start: number; end: number; duration: number } {
  const startParsed = parseTimeWithValidation(startTime);
  const endParsed = parseTimeWithValidation(endTime);
  
  // Check if we have valid timestamps
  if (!startParsed.valid && !endParsed.valid) {
    return {
      valid: false,
      error: 'Missing timestamps: both start and end are invalid',
      start: 0,
      end: 0,
      duration: 0,
    };
  }
  
  if (!startParsed.valid) {
    return {
      valid: false,
      error: `Invalid start time: ${startParsed.original}`,
      start: 0,
      end: endParsed.seconds,
      duration: 0,
    };
  }
  
  if (!endParsed.valid) {
    return {
      valid: false,
      error: `Invalid end time: ${endParsed.original}`,
      start: startParsed.seconds,
      end: 0,
      duration: 0,
    };
  }
  
  const start = startParsed.seconds;
  const end = endParsed.seconds;
  const duration = end - start;
  
  // Check logical constraints
  if (end <= start) {
    return {
      valid: false,
      error: `End time (${end}s) must be greater than start time (${start}s)`,
      start,
      end,
      duration,
    };
  }
  
  // Very short segments (< 100ms) are likely errors
  if (duration < 0.1) {
    return {
      valid: false,
      error: `Segment too short: ${duration.toFixed(3)}s`,
      start,
      end,
      duration,
    };
  }
  
  // Check against audio duration if provided
  if (audioDuration !== undefined) {
    if (start >= audioDuration) {
      return {
        valid: false,
        error: `Start time (${start}s) exceeds audio duration (${audioDuration.toFixed(1)}s)`,
        start,
        end,
        duration,
      };
    }
  }
  
  return { valid: true, start, end, duration };
}

/**
 * Singleton class for managing audio segment playback
 * Uses AudioContext for precise timing control
 * Emits events for state synchronization across components
 */
class SegmentPlayer {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private loadedAudioId: string | null = null;
  private currentSegmentId: string | null = null;
  private isCurrentlyLoading = false;
  private loadingAudioId: string | null = null;
  
  // Event emitter for state synchronization
  private listeners: Set<SegmentPlayerEventListener> = new Set();

  /**
   * Subscribe to player events
   * Returns unsubscribe function
   */
  subscribe(listener: SegmentPlayerEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SegmentPlayerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('SegmentPlayer event listener error', { 
          event: event.type, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    }
  }

  /**
   * Initialize or get existing AudioContext
   */
  private getContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  /**
   * Get current state for hook initialization
   */
  getState(): { 
    isLoading: boolean; 
    loadingAudioId: string | null;
    loadedAudioId: string | null; 
    audioDuration: number | null;
    isPlaying: boolean;
    currentSegmentId: string | null;
  } {
    return {
      isLoading: this.isCurrentlyLoading,
      loadingAudioId: this.loadingAudioId,
      loadedAudioId: this.loadedAudioId,
      audioDuration: this.audioBuffer?.duration ?? null,
      isPlaying: this.currentSource !== null,
      currentSegmentId: this.currentSegmentId,
    };
  }

  /**
   * Load audio from Blob and decode it
   * Caches the buffer for the given audioId
   * Emits events for loading states
   */
  async loadAudio(audioBlob: Blob, audioId: string): Promise<void> {
    // Skip if already loaded
    if (this.loadedAudioId === audioId && this.audioBuffer) {
      logger.debug('Audio already loaded', { audioId });
      return;
    }

    // Skip if already loading this audio
    if (this.isCurrentlyLoading && this.loadingAudioId === audioId) {
      logger.debug('Audio already loading', { audioId });
      return;
    }

    this.isCurrentlyLoading = true;
    this.loadingAudioId = audioId;
    this.emit({ type: 'loading', audioId });
    
    logger.info('Loading audio', { audioId, blobSize: audioBlob.size });

    try {
      const context = this.getContext();
      
      // Resume context if suspended (browser autoplay policy)
      if (context.state === 'suspended') {
        await context.resume();
      }

      const arrayBuffer = await audioBlob.arrayBuffer();
      this.audioBuffer = await context.decodeAudioData(arrayBuffer);
      this.loadedAudioId = audioId;
      
      const duration = this.audioBuffer.duration;
      logger.info('Audio loaded successfully', { 
        audioId, 
        duration: duration.toFixed(2),
        sampleRate: this.audioBuffer.sampleRate,
        channels: this.audioBuffer.numberOfChannels,
      });
      
      this.emit({ type: 'loaded', audioId, duration });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('Failed to load audio', { audioId, error: errorMsg });
      this.emit({ type: 'error', audioId, error: errorMsg });
      throw err;
    } finally {
      this.isCurrentlyLoading = false;
      this.loadingAudioId = null;
    }
  }

  /**
   * Check if audio is loaded
   */
  isLoaded(audioId: string): boolean {
    return this.loadedAudioId === audioId && this.audioBuffer !== null;
  }

  /**
   * Check if currently loading a specific audio
   */
  isLoadingAudio(audioId: string): boolean {
    return this.isCurrentlyLoading && this.loadingAudioId === audioId;
  }

  /**
   * Get loaded audio duration in seconds
   */
  getLoadedDuration(): number | null {
    return this.audioBuffer?.duration ?? null;
  }

  /**
   * Play a segment from startTime to endTime
   * Validates time range before attempting playback
   */
  play(
    segmentId: string,
    startTime: string | number,
    endTime: string | number,
    options?: SegmentPlaybackOptions
  ): void {
    if (!this.audioBuffer) {
      const error = new Error('Audio not loaded');
      logger.error('Playback failed: audio not loaded', { segmentId });
      options?.onError?.(error);
      return;
    }

    // Validate time range
    const validation = validateSegmentTimeRange(startTime, endTime, this.audioBuffer.duration);
    
    if (!validation.valid) {
      const error = new Error(validation.error);
      logger.warn('Playback skipped: invalid time range', { 
        segmentId, 
        error: validation.error,
        startTime,
        endTime,
      });
      options?.onError?.(error);
      return;
    }

    // Stop any currently playing segment
    this.stop();

    const context = this.getContext();
    
    // Clamp to buffer bounds (for safety, even after validation)
    const clampedStart = Math.min(validation.start, this.audioBuffer.duration);
    const clampedDuration = Math.min(
      validation.duration, 
      this.audioBuffer.duration - clampedStart
    );

    if (clampedDuration <= 0) {
      const error = new Error('Segment outside audio bounds after clamping');
      logger.warn('Playback skipped: clamped duration <= 0', { 
        segmentId, 
        clampedStart, 
        clampedDuration,
        audioDuration: this.audioBuffer.duration,
      });
      options?.onError?.(error);
      return;
    }

    logger.debug('Starting segment playback', { 
      segmentId, 
      start: clampedStart.toFixed(2), 
      duration: clampedDuration.toFixed(2),
    });

    // Create and configure source
    const source = context.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(context.destination);

    this.currentSegmentId = segmentId;
    this.emit({ type: 'playStart', segmentId });

    source.onended = () => {
      const endedSegmentId = this.currentSegmentId;
      this.currentSource = null;
      this.currentSegmentId = null;
      
      if (endedSegmentId) {
        logger.debug('Segment playback ended', { segmentId: endedSegmentId });
        this.emit({ type: 'playEnd', segmentId: endedSegmentId });
      }
      options?.onEnded?.();
    };

    // Start playback at offset with duration
    source.start(0, clampedStart, clampedDuration);
    this.currentSource = source;
  }

  /**
   * Stop current playback
   */
  stop(): void {
    if (this.currentSource) {
      const stoppedSegmentId = this.currentSegmentId;
      try {
        this.currentSource.stop();
      } catch {
        // Ignore if already stopped
      }
      this.currentSource = null;
      this.currentSegmentId = null;
      
      if (stoppedSegmentId) {
        logger.debug('Segment playback stopped', { segmentId: stoppedSegmentId });
        this.emit({ type: 'playEnd', segmentId: stoppedSegmentId });
      }
    }
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.currentSource !== null;
  }

  /**
   * Get currently playing segment ID
   */
  getCurrentSegmentId(): string | null {
    return this.currentSegmentId;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.audioBuffer = null;
    this.loadedAudioId = null;
    this.listeners.clear();
    this.emit({ type: 'disposed' });
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    logger.info('SegmentPlayer disposed');
  }
}

// Export singleton instance
export const segmentPlayer = new SegmentPlayer();
