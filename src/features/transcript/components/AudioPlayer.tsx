import { useEffect, useRef, useState, useCallback, memo, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
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
    if (!containerRef.current) {
      console.log('[AudioPlayer] No container ref, skipping init');
      return;
    }

    console.log('[AudioPlayer] Initializing WaveSurfer...');
    let isDestroyed = false;
    
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'var(--audio-waveform-base)',
      progressColor: 'var(--audio-waveform-progress)',
      cursorColor: 'var(--interactive-primary)',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 64,
      normalize: true,
    });

    wavesurferRef.current = wavesurfer;

    wavesurfer.on('ready', () => {
      console.log('[AudioPlayer] WaveSurfer ready');
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

    console.log('[AudioPlayer] Loading audio URL:', audioUrl.substring(0, 50));
    wavesurfer.load(audioUrl);

    return () => {
      isDestroyed = true;
      wavesurferRef.current = null;
      // Unsubscribe all events first to prevent callbacks during destroy
      wavesurfer.unAll();
      try {
        wavesurfer.destroy();
      } catch (err) {
        // Suppress abort errors during cleanup - these are expected during component unmount
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('[AudioPlayer] Cleanup error:', err);
        }
      }
    };
  }, [audioUrl]); // Remove onTimeUpdate, onReady from deps - they don't need to trigger reinit

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

  return (
    <div className={cn('rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-sm)]', className)}>
      {/* Waveform */}
      <div 
        ref={containerRef} 
        className={cn(
          'mb-5 rounded-lg overflow-hidden',
          !isReady && 'animate-pulse bg-[var(--bg-secondary)]'
        )}
        style={{ minHeight: '64px' }}
      />

      {/* Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            disabled={!isReady}
            className={cn(
              'group relative h-12 w-12 rounded-full transition-all duration-200',
              'bg-[var(--interactive-primary)] hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]',
              'shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-lg)]',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-[var(--shadow-md)]',
              'flex items-center justify-center',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2'
            )}
            title="Play/Pause (Space)"
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 text-[var(--text-on-color)] transition-transform group-hover:scale-110" />
            ) : (
              <Play className="h-5 w-5 ml-0.5 text-[var(--text-on-color)] transition-transform group-hover:scale-110" />
            )}
          </button>

          {/* Time display */}
          <div className="flex items-baseline gap-1.5 font-mono text-[13px] leading-none">
            <span className="font-medium text-[var(--text-primary)] tabular-nums">{formatDuration(currentTime)}</span>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-secondary)] tabular-nums">{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Playback speed */}
          <button
            onClick={handleSpeedChange}
            className={cn(
              'group relative px-3 py-1.5 rounded-md text-[12px] font-semibold tabular-nums',
              'bg-[var(--interactive-secondary)] hover:bg-[var(--interactive-secondary-hover)]',
              'text-[var(--text-primary)] transition-all duration-150',
              'border border-[var(--border-subtle)] hover:border-[var(--border-default)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
            )}
            title="Change playback speed"
          >
            <span className="group-hover:scale-105 inline-block transition-transform">{playbackRate}×</span>
          </button>

          {/* Volume */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggleMute}
              className={cn(
                'group rounded-md p-1.5 transition-all duration-150',
                'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                'hover:bg-[var(--interactive-secondary)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
              )}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4 transition-transform group-hover:scale-110" />
              ) : (
                <Volume2 className="h-4 w-4 transition-transform group-hover:scale-110" />
              )}
            </button>
            
            {/* Custom styled range input */}
            <div className="relative w-20 flex items-center">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className={cn(
                  'volume-slider w-full h-1.5 cursor-pointer appearance-none rounded-full',
                  'bg-[var(--bg-secondary)]',
                  'transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1'
                )}
                style={{
                  background: `linear-gradient(to right, var(--interactive-primary) 0%, var(--interactive-primary) ${(isMuted ? 0 : volume) * 100}%, var(--bg-secondary) ${(isMuted ? 0 : volume) * 100}%, var(--bg-secondary) 100%)`
                }}
                title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}));
