/**
 * Segment Audio Player
 * AudioContext-based service for sample-accurate segment playback
 */

export interface SegmentPlaybackOptions {
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Parse time string (HH:MM:SS or MM:SS) to seconds
 */
export function parseTimeToSeconds(time: string | number | undefined): number {
  if (time === undefined || time === null) return 0;
  if (typeof time === 'number') return time;
  
  const parts = time.split(':').map(Number);
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  return parseFloat(time) || 0;
}

/**
 * Singleton class for managing audio segment playback
 * Uses AudioContext for precise timing control
 */
class SegmentPlayer {
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private loadedAudioId: string | null = null;

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
   * Load audio from Blob and decode it
   * Caches the buffer for the given audioId
   */
  async loadAudio(audioBlob: Blob, audioId: string): Promise<void> {
    // Skip if already loaded
    if (this.loadedAudioId === audioId && this.audioBuffer) {
      return;
    }

    const context = this.getContext();
    
    // Resume context if suspended (browser autoplay policy)
    if (context.state === 'suspended') {
      await context.resume();
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    this.audioBuffer = await context.decodeAudioData(arrayBuffer);
    this.loadedAudioId = audioId;
  }

  /**
   * Check if audio is loaded
   */
  isLoaded(audioId: string): boolean {
    return this.loadedAudioId === audioId && this.audioBuffer !== null;
  }

  /**
   * Play a segment from startTime to endTime
   */
  play(
    startTime: string | number,
    endTime: string | number,
    options?: SegmentPlaybackOptions
  ): void {
    if (!this.audioBuffer) {
      options?.onError?.(new Error('Audio not loaded'));
      return;
    }

    // Stop any currently playing segment
    this.stop();

    const context = this.getContext();
    const startSeconds = parseTimeToSeconds(startTime);
    const endSeconds = parseTimeToSeconds(endTime);
    const duration = Math.max(0, endSeconds - startSeconds);

    // Clamp to buffer bounds
    const clampedStart = Math.min(startSeconds, this.audioBuffer.duration);
    const clampedDuration = Math.min(duration, this.audioBuffer.duration - clampedStart);

    if (clampedDuration <= 0) {
      options?.onError?.(new Error('Invalid segment time range'));
      return;
    }

    // Create and configure source
    const source = context.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(context.destination);

    source.onended = () => {
      this.currentSource = null;
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
      try {
        this.currentSource.stop();
      } catch {
        // Ignore if already stopped
      }
      this.currentSource = null;
    }
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.currentSource !== null;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.audioBuffer = null;
    this.loadedAudioId = null;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Export singleton instance
export const segmentPlayer = new SegmentPlayer();
