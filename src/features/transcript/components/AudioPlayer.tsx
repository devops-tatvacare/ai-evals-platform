import { useEffect, useRef, useState, useCallback, memo, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui';
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
    play: () => {
      wavesurferRef.current?.play();
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
      waveColor: 'var(--color-brand-accent)',
      progressColor: 'var(--color-brand-primary)',
      cursorColor: 'var(--text-primary)',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 64,
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

    wavesurfer.load(audioUrl);

    return () => {
      isDestroyed = true;
      wavesurferRef.current = null;
      // Unsubscribe all events first to prevent callbacks during destroy
      wavesurfer.unAll();
      wavesurfer.destroy();
    };
  }, [audioUrl, onTimeUpdate, onReady]);

  const togglePlayPause = useCallback(() => {
    wavesurferRef.current?.playPause();
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
    <div className={cn('rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-4', className)}>
      {/* Waveform */}
      <div 
        ref={containerRef} 
        className={cn(
          'mb-4 rounded',
          !isReady && 'animate-pulse bg-[var(--bg-secondary)]'
        )}
        style={{ minHeight: '64px' }}
      />

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <Button
            size="sm"
            onClick={togglePlayPause}
            disabled={!isReady}
            className="h-10 w-10 rounded-full p-0"
            title="Play/Pause (Space)"
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>

          {/* Time display */}
          <div className="text-[13px] font-mono text-[var(--text-secondary)]">
            <span>{formatDuration(currentTime)}</span>
            <span className="mx-1 text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-muted)]">{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Playback speed */}
          <button
            onClick={handleSpeedChange}
            className="rounded px-2 py-1 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]"
            title="Change playback speed"
          >
            {playbackRate}x
          </button>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-[var(--bg-secondary)] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-brand-primary)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}));
