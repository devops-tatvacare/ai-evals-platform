import { useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { filesRepository } from '@/services/storage';
import { useMiniPlayerStore } from '@/stores';

const SEEK_AMOUNT = 5;

function resolveColor(prop: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

export function useMiniPlayerAudio(audioFileId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!audioFileId || !containerRef.current) return;

    let isDestroyed = false;
    const container = containerRef.current;

    // Capture the position we need to seek to BEFORE any async work.
    // This comes from the main AudioPlayer's position at pop-out time.
    const { currentTime: seekTime, playbackRate: seekRate } = useMiniPlayerStore.getState();

    async function init() {
      try {
        const blob = await filesRepository.getBlob(audioFileId!);
        if (!blob || isDestroyed) return;

        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        const ws = WaveSurfer.create({
          container,
          waveColor: resolveColor('--audio-waveform-base'),
          progressColor: resolveColor('--audio-waveform-progress'),
          cursorColor: resolveColor('--interactive-primary'),
          cursorWidth: 1,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          height: 32,
          normalize: true,
        });

        wavesurferRef.current = ws;

        ws.on('ready', () => {
          if (isDestroyed) return;
          const dur = ws.getDuration();
          useMiniPlayerStore.getState().setPlaybackState({
            isReady: true,
            duration: dur,
          });

          // Seek to the position from the main player
          if (seekTime > 0 && dur > 0) {
            ws.seekTo(Math.min(seekTime / dur, 1));
          }
          if (seekRate !== 1) {
            ws.setPlaybackRate(seekRate);
          }

          ws.play();
        });

        ws.on('timeupdate', (time: number) => {
          if (isDestroyed) return;
          useMiniPlayerStore.getState().setPlaybackState({ currentTime: time });
        });

        ws.on('play', () => {
          if (!isDestroyed) useMiniPlayerStore.getState().setPlaybackState({ isPlaying: true });
        });

        ws.on('pause', () => {
          if (!isDestroyed) useMiniPlayerStore.getState().setPlaybackState({ isPlaying: false });
        });

        ws.on('finish', () => {
          if (!isDestroyed) useMiniPlayerStore.getState().setPlaybackState({ isPlaying: false });
        });

        // Theme change observer
        const observer = new MutationObserver(() => {
          if (isDestroyed) return;
          requestAnimationFrame(() => {
            ws.setOptions({
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

        ws.load(url);

        (ws as any).__themeObserver = observer;
      } catch (err) {
        console.error('[MiniPlayer] Failed to load audio:', err);
      }
    }

    init();

    return () => {
      isDestroyed = true;

      const ws = wavesurferRef.current;
      if (ws) {
        (ws as any).__themeObserver?.disconnect();
        wavesurferRef.current = null;
        ws.unAll();
        try {
          ws.destroy();
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            console.error('[MiniPlayer] Cleanup error:', err);
          }
        }
      }

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [audioFileId]);

  const togglePlayPause = useCallback(() => {
    wavesurferRef.current?.playPause();
  }, []);

  const seekForward = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const duration = ws.getDuration();
    if (duration <= 0) return;
    const newTime = Math.min(ws.getCurrentTime() + SEEK_AMOUNT, duration);
    ws.seekTo(newTime / duration);
  }, []);

  const seekBackward = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const duration = ws.getDuration();
    if (duration <= 0) return;
    const newTime = Math.max(ws.getCurrentTime() - SEEK_AMOUNT, 0);
    ws.seekTo(newTime / duration);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    wavesurferRef.current?.setPlaybackRate(rate);
    useMiniPlayerStore.getState().setPlaybackState({ playbackRate: rate });
  }, []);

  return { containerRef, togglePlayPause, seekForward, seekBackward, setPlaybackRate };
}
