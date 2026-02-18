import { memo, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Music, Maximize2 } from 'lucide-react';
import { cn, formatDuration } from '@/utils';
import { useMiniPlayerStore, useUIStore } from '@/stores';

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface MiniPlayerProps {
  waveformRef: React.RefObject<HTMLDivElement | null>;
  onTogglePlayPause: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onSetPlaybackRate: (rate: number) => void;
  onPopIn: () => void;
}

export const MiniPlayer = memo(function MiniPlayer({
  waveformRef,
  onTogglePlayPause,
  onSeekForward,
  onSeekBackward,
  onSetPlaybackRate,
  onPopIn,
}: MiniPlayerProps) {
  const isPlaying = useMiniPlayerStore((s) => s.isPlaying);
  const isReady = useMiniPlayerStore((s) => s.isReady);
  const currentTime = useMiniPlayerStore((s) => s.currentTime);
  const duration = useMiniPlayerStore((s) => s.duration);
  const playbackRate = useMiniPlayerStore((s) => s.playbackRate);
  const listingTitle = useMiniPlayerStore((s) => s.listingTitle);
  const close = useMiniPlayerStore((s) => s.close);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  const handleSpeedChange = useCallback(() => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    onSetPlaybackRate(PLAYBACK_SPEEDS[nextIndex]);
  }, [playbackRate, onSetPlaybackRate]);

  const sidebarWidth = sidebarCollapsed ? '3.5rem' : '280px';

  return (
    <div
      className={cn(
        'fixed bottom-0 right-0 z-30',
        'animate-in slide-in-from-bottom duration-300',
        'border-t border-[var(--border-subtle)]',
        'bg-[var(--bg-elevated)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]',
        'backdrop-blur-sm',
      )}
      style={{ left: sidebarWidth }}
    >
      {/* Compact waveform progress bar */}
      <div className="px-4 pt-2">
        <div
          ref={waveformRef}
          className={cn(
            'rounded overflow-hidden',
            !isReady && 'animate-pulse bg-[var(--bg-tertiary)]',
          )}
          style={{ minHeight: '32px' }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Title with icon */}
        <div className="flex items-center gap-2 min-w-0 flex-shrink">
          <Music className="h-3.5 w-3.5 text-[var(--interactive-primary)] flex-shrink-0" />
          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate max-w-[200px]">
            {listingTitle || 'Untitled'}
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={onSeekBackward}
            disabled={!isReady}
            className={cn(
              'h-7 w-7 rounded-full flex items-center justify-center',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              'hover:bg-[var(--interactive-secondary)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'transition-all duration-150',
            )}
            title="Back 5s"
          >
            <SkipBack className="h-3 w-3" />
          </button>

          <button
            onClick={onTogglePlayPause}
            disabled={!isReady}
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center',
              'bg-[var(--interactive-primary)] hover:bg-[var(--interactive-primary-hover)]',
              'shadow-[var(--shadow-sm)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'transition-all duration-150',
            )}
            title="Play / Pause"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5 text-[var(--text-on-color)]" />
            ) : (
              <Play className="h-3.5 w-3.5 ml-0.5 text-[var(--text-on-color)]" />
            )}
          </button>

          <button
            onClick={onSeekForward}
            disabled={!isReady}
            className={cn(
              'h-7 w-7 rounded-full flex items-center justify-center',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              'hover:bg-[var(--interactive-secondary)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'transition-all duration-150',
            )}
            title="Forward 5s"
          >
            <SkipForward className="h-3 w-3" />
          </button>
        </div>

        {/* Time display */}
        <div className="flex items-baseline gap-1 font-mono text-[12px] leading-none select-none tabular-nums">
          <span className={cn(
            'font-semibold transition-colors duration-200',
            isPlaying ? 'text-[var(--interactive-primary)]' : 'text-[var(--text-primary)]',
          )}>
            {formatDuration(currentTime)}
          </span>
          <span className="text-[var(--text-muted)] text-[10px]">/</span>
          <span className="text-[var(--text-muted)]">{formatDuration(duration)}</span>
        </div>

        {/* Speed pill */}
        <button
          onClick={handleSpeedChange}
          className={cn(
            'h-6 min-w-[36px] px-1.5 rounded-full text-[10px] font-bold tabular-nums',
            'transition-all duration-150',
            playbackRate !== 1
              ? 'bg-[var(--interactive-primary)]/10 text-[var(--interactive-primary)] border border-[var(--interactive-primary)]/25'
              : 'bg-[var(--interactive-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
          )}
          title="Playback speed"
        >
          {playbackRate}x
        </button>

        {/* Pop in — return to full player view */}
        <button
          onClick={onPopIn}
          className={cn(
            'h-7 w-7 rounded-full flex items-center justify-center',
            'text-[var(--text-secondary)] hover:text-[var(--interactive-primary)]',
            'hover:bg-[var(--interactive-primary)]/10',
            'transition-all duration-150',
          )}
          title="Open in full player"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-[var(--border-subtle)]" />

        {/* Close button */}
        <button
          onClick={close}
          className={cn(
            'h-7 w-7 rounded-full flex items-center justify-center',
            'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
            'hover:bg-[var(--interactive-secondary)]',
            'transition-all duration-150',
          )}
          title="Close mini player"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
