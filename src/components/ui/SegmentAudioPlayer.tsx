import { memo } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';

interface SegmentAudioPlayerProps {
  isPlaying: boolean;
  isLoading: boolean;
  isReady: boolean;
  onPlay: () => void;
  onStop: () => void;
  className?: string;
}

/**
 * Minimal audio player button for segment playback
 */
export const SegmentAudioPlayer = memo(function SegmentAudioPlayer({
  isPlaying,
  isLoading,
  isReady,
  onPlay,
  onStop,
  className = '',
}: SegmentAudioPlayerProps) {
  if (isLoading) {
    return (
      <button
        disabled
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] ${className}`}
        title="Loading audio..."
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </button>
    );
  }

  if (!isReady) {
    return (
      <button
        disabled
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] opacity-50 ${className}`}
        title="Audio not available"
      >
        <Play className="h-3 w-3" />
      </button>
    );
  }

  if (isPlaying) {
    return (
      <button
        onClick={onStop}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-error)] text-[var(--text-on-color)] transition-colors hover:bg-[var(--color-error)]/80 ${className}`}
        title="Stop"
      >
        <Square className="h-3 w-3" />
      </button>
    );
  }

  return (
    <button
      onClick={onPlay}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand-primary)] text-[var(--text-on-color)] transition-colors hover:bg-[var(--color-brand-primary)]/80 ${className}`}
      title="Play segment"
    >
      <Play className="h-3 w-3" />
    </button>
  );
});
