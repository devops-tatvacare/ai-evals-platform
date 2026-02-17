import { useEffect, useRef, useState, useCallback, memo, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Keyboard } from 'lucide-react';
import { cn, formatDuration } from '@/utils';
import { useKeyboardShortcuts } from '@/hooks';

export interface AudioPlayerHandle {
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
}

interface AudioPlayerProps {
  audioUrl: string;
  onTimeUpdate?: (time: number) => void;
  onReady?: (duration: number) => void;
  className?: string;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SEEK_AMOUNT = 5; // seconds

/** Resolve a CSS custom property to its computed color value */
function resolveColor(prop: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

export const AudioPlayer = memo(forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({
  audioUrl,
  onTimeUpdate,
  onReady,
  className,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    seekTo: (time: number) => {
      if (wavesurferRef.current && duration > 0) {
        wavesurferRef.current.seekTo(time / duration);
      }
    },
    play: async () => {
      const ws = wavesurferRef.current;
      if (!ws) return;

      // Resume AudioContext if suspended
      const audioContext = (ws as any).backend?.audioContext;
      if (audioContext && audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (err) {
          console.error('[AudioPlayer] Failed to resume AudioContext:', err);
        }
      }

      ws.play();
    },
    pause: () => {
      wavesurferRef.current?.pause();
    },
  }), [duration]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current) return;

    let isDestroyed = false;

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: resolveColor('--audio-waveform-base'),
      progressColor: resolveColor('--audio-waveform-progress'),
      cursorColor: resolveColor('--interactive-primary'),
      cursorWidth: 2,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      height: 72,
      normalize: true,
    });

    wavesurferRef.current = wavesurfer;

    wavesurfer.on('ready', () => {
      if (isDestroyed) return;
      setIsReady(true);
      const dur = wavesurfer.getDuration();
      setDuration(dur);
      onReady?.(dur);
    });

    wavesurfer.on('timeupdate', (time: number) => {
      if (isDestroyed) return;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    });

    wavesurfer.on('play', () => !isDestroyed && setIsPlaying(true));
    wavesurfer.on('pause', () => !isDestroyed && setIsPlaying(false));
    wavesurfer.on('finish', () => !isDestroyed && setIsPlaying(false));

    wavesurfer.on('error', (err) => {
      console.error('[AudioPlayer] WaveSurfer error:', err);
    });

    // Re-resolve colors when theme changes (data-theme attribute on <html>)
    const observer = new MutationObserver(() => {
      if (isDestroyed) return;
      // Small delay lets the browser recompute CSS custom properties
      requestAnimationFrame(() => {
        wavesurfer.setOptions({
          waveColor: resolveColor('--audio-waveform-base'),
          progressColor: resolveColor('--audio-waveform-progress'),
          cursorColor: resolveColor('--interactive-primary'),
        });
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    wavesurfer.load(audioUrl);

    return () => {
      isDestroyed = true;
      observer.disconnect();
      wavesurferRef.current = null;
      wavesurfer.unAll();
      try {
        wavesurfer.destroy();
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('[AudioPlayer] Cleanup error:', err);
        }
      }
    };
  }, [audioUrl]);

  const togglePlayPause = useCallback(async () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.playPause();
  }, []);

  const seekForward = useCallback(() => {
    if (wavesurferRef.current && duration > 0) {
      const newTime = Math.min(currentTime + SEEK_AMOUNT, duration);
      wavesurferRef.current.seekTo(newTime / duration);
    }
  }, [currentTime, duration]);

  const seekBackward = useCallback(() => {
    if (wavesurferRef.current && duration > 0) {
      const newTime = Math.max(currentTime - SEEK_AMOUNT, 0);
      wavesurferRef.current.seekTo(newTime / duration);
    }
  }, [currentTime, duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    wavesurferRef.current?.setVolume(newVolume);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      wavesurferRef.current?.setVolume(volume || 1);
      setIsMuted(false);
    } else {
      wavesurferRef.current?.setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const handleSpeedChange = useCallback(() => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    const newRate = PLAYBACK_SPEEDS[nextIndex];
    setPlaybackRate(newRate);
    wavesurferRef.current?.setPlaybackRate(newRate);
  }, [playbackRate]);

  // Keyboard shortcuts for audio control
  useKeyboardShortcuts([
    {
      key: ' ',
      action: togglePlayPause,
      description: 'Play/Pause audio',
    },
    {
      key: 'ArrowLeft',
      action: seekBackward,
      description: 'Seek backward 5 seconds',
    },
    {
      key: 'ArrowRight',
      action: seekForward,
      description: 'Seek forward 5 seconds',
    },
  ], { enabled: isReady });

  const effectiveVolume = isMuted ? 0 : volume;

  return (
    <div className={cn(
      'rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)] overflow-hidden',
      isPlaying && 'border-[var(--color-brand-primary)]/40 shadow-[var(--shadow-md)]',
      'transition-[border-color,box-shadow] duration-300',
      className
    )}>
      {/* Waveform region — tinted backdrop for visual depth */}
      <div className="relative bg-[var(--bg-secondary)]">
        {/* Subtle brand gradient overlay when playing */}
        <div className={cn(
          'absolute inset-0 transition-opacity duration-500 pointer-events-none',
          'bg-gradient-to-r from-[var(--color-brand-primary)]/[0.04] via-transparent to-[var(--color-brand-primary)]/[0.04]',
          isPlaying ? 'opacity-100' : 'opacity-0'
        )} />

        {/* Waveform container */}
        <div className="px-5 pt-5 pb-4">
          <div
            ref={containerRef}
            className={cn(
              'rounded-lg overflow-hidden',
              !isReady && 'animate-pulse bg-[var(--bg-tertiary)]'
            )}
            style={{ minHeight: '72px' }}
          />
        </div>

        {/* Separator between waveform and controls */}
        <div className="h-px bg-[var(--border-subtle)]" />
      </div>

      {/* Controls */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-4">
          {/* Left: transport controls */}
          <div className="flex items-center gap-2">
            {/* Skip back */}
            <button
              onClick={seekBackward}
              disabled={!isReady}
              className={cn(
                'group relative h-8 w-8 rounded-full flex items-center justify-center',
                'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--interactive-secondary)] active:bg-[var(--interactive-secondary-hover)]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                'transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
              )}
              title="Back 5s (←)"
            >
              <SkipBack className="h-3.5 w-3.5 transition-transform group-hover:scale-110 group-active:scale-95" />
            </button>

            {/* Play / Pause — hero button */}
            <button
              onClick={togglePlayPause}
              disabled={!isReady}
              className={cn(
                'audio-play-btn group relative h-11 w-11 rounded-full flex items-center justify-center',
                'bg-[var(--interactive-primary)] hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]',
                'shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-lg)]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-[var(--shadow-md)]',
                'transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2',
                isPlaying && 'audio-play-btn--active'
              )}
              title="Play / Pause (Space)"
            >
              {isPlaying ? (
                <Pause className="h-[18px] w-[18px] text-[var(--text-on-color)] transition-transform group-hover:scale-110" />
              ) : (
                <Play className="h-[18px] w-[18px] ml-0.5 text-[var(--text-on-color)] transition-transform group-hover:scale-110" />
              )}
            </button>

            {/* Skip forward */}
            <button
              onClick={seekForward}
              disabled={!isReady}
              className={cn(
                'group relative h-8 w-8 rounded-full flex items-center justify-center',
                'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--interactive-secondary)] active:bg-[var(--interactive-secondary-hover)]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                'transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
              )}
              title="Forward 5s (→)"
            >
              <SkipForward className="h-3.5 w-3.5 transition-transform group-hover:scale-110 group-active:scale-95" />
            </button>
          </div>

          {/* Center: time display */}
          <div className="flex items-baseline gap-1 font-mono text-[13px] leading-none select-none">
            <span className={cn(
              'font-semibold tabular-nums transition-colors duration-200',
              isPlaying ? 'text-[var(--interactive-primary)]' : 'text-[var(--text-primary)]'
            )}>
              {formatDuration(currentTime)}
            </span>
            <span className="text-[var(--text-muted)] text-[11px] mx-0.5">/</span>
            <span className="text-[var(--text-muted)] tabular-nums">{formatDuration(duration)}</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right: secondary controls */}
          <div className="flex items-center gap-1.5">
            {/* Playback speed pill */}
            <button
              onClick={handleSpeedChange}
              className={cn(
                'group h-7 min-w-[42px] px-2 rounded-full text-[11px] font-bold tabular-nums',
                'transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
                playbackRate !== 1
                  ? 'bg-[var(--interactive-primary)]/10 text-[var(--interactive-primary)] border border-[var(--interactive-primary)]/25 hover:bg-[var(--interactive-primary)]/15'
                  : 'bg-[var(--interactive-secondary)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--interactive-secondary-hover)] hover:text-[var(--text-primary)]'
              )}
              title="Playback speed"
            >
              {playbackRate}x
            </button>

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />

            {/* Volume group */}
            <div className="flex items-center gap-1.5 group/vol">
              <button
                onClick={toggleMute}
                className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center',
                  'transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
                  isMuted || volume === 0
                    ? 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]'
                )}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-3.5 w-3.5" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </button>

              {/* Volume slider */}
              <div className="relative w-[72px] flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={effectiveVolume}
                  onChange={handleVolumeChange}
                  className={cn(
                    'volume-slider w-full h-[5px] cursor-pointer appearance-none rounded-full',
                    'transition-all duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1'
                  )}
                  style={{
                    background: `linear-gradient(to right, var(--interactive-primary) 0%, var(--interactive-primary) ${effectiveVolume * 100}%, var(--bg-tertiary) ${effectiveVolume * 100}%, var(--bg-tertiary) 100%)`
                  }}
                  title={`Volume: ${Math.round(effectiveVolume * 100)}%`}
                />
              </div>
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />

            {/* Keyboard shortcuts toggle */}
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              className={cn(
                'h-7 w-7 rounded-full flex items-center justify-center',
                'transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
                showShortcuts
                  ? 'bg-[var(--interactive-primary)]/10 text-[var(--interactive-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]'
              )}
              title="Keyboard shortcuts"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Keyboard shortcuts bar — collapses in */}
        <div className={cn(
          'grid transition-all duration-200 ease-out',
          showShortcuts ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0'
        )}>
          <div className="overflow-hidden">
            <div className="flex items-center justify-center gap-4 py-2 px-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
              <KbdHint keys={['Space']} label="Play / Pause" />
              <KbdHint keys={['←']} label="Back 5s" />
              <KbdHint keys={['→']} label="Skip 5s" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}));

/** Keyboard shortcut hint chip */
function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex items-center justify-center h-5 min-w-[22px] px-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] font-mono text-[10px] font-medium text-[var(--text-secondary)] shadow-[0_1px_0_var(--border-subtle)]"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}
