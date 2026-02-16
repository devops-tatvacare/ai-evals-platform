import { useState, useCallback, useEffect, useRef } from 'react';
import { AudioPlayer, type AudioPlayerHandle } from './AudioPlayer';
import { DiarizedTranscript } from './DiarizedTranscript';
import { TranscriptZeroState } from './TranscriptZeroState';
import { useTranscriptSync } from '../hooks/useTranscriptSync';
import { Card, Skeleton } from '@/components/ui';
import { filesRepository } from '@/services/storage';
import type { Listing } from '@/types';
import { FileAudio, FileText } from 'lucide-react';

interface TranscriptViewProps {
  listing: Listing;
}

export function TranscriptView({ listing }: TranscriptViewProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const audioPlayerRef = useRef<AudioPlayerHandle>(null);

  const { transcript, audioFile, sourceType } = listing;
  const isApiFlow = sourceType === 'api';
  const hasTranscript = !!transcript;
  const segments = transcript?.segments ?? [];

  const {
    activeIndex,
    handleTimeUpdate,
    seekToSegment,
    getSegmentTime,
  } = useTranscriptSync({ segments });

  // Cleanup function ref to avoid stale closures
  const audioUrlRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    async function loadAudio() {
      if (!audioFile?.id) return;
      
      // Prevent duplicate loads
      if (loadingRef.current) return;
      loadingRef.current = true;

      setIsLoadingAudio(true);
      
      try {
        const blob = await filesRepository.getBlob(audioFile.id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          setAudioUrl(url);
        }
      } catch (err) {
        console.error('Failed to load audio:', err);
      } finally {
        setIsLoadingAudio(false);
        loadingRef.current = false;
      }
    }

    loadAudio();

    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [audioFile?.id]);

  // Handle segment click - seek audio to segment time
  const handleSegmentClick = useCallback((index: number) => {
    const time = getSegmentTime(index);
    audioPlayerRef.current?.seekTo(time);
    seekToSegment(index);
  }, [getSegmentTime, seekToSegment]);

  // Handle time updates from wavesurfer
  const handleAudioTimeUpdate = useCallback((time: number) => {
    handleTimeUpdate(time);
  }, [handleTimeUpdate]);

  // Zero state - no transcript yet
  if (!hasTranscript) {
    return (
      <div className="space-y-4">
        {/* Audio player still shows if audio exists */}
        {audioFile && (
          <>
            {isLoadingAudio ? (
              <Card className="p-4">
                <Skeleton className="h-16 w-full rounded" />
                <div className="mt-4 flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </Card>
            ) : audioUrl ? (
              <AudioPlayer
                ref={audioPlayerRef}
                audioUrl={audioUrl}
                onTimeUpdate={handleAudioTimeUpdate}
              />
            ) : (
              <Card className="p-4 text-center text-[var(--text-muted)]">
                Failed to load audio file
              </Card>
            )}
          </>
        )}
        <TranscriptZeroState sourceType={sourceType} />
      </div>
    );
  }

  // API flow - flat transcript display (no segments)
  if (isApiFlow) {
    return (
      <div className="space-y-4">
        {audioFile && (
          <>
            {isLoadingAudio ? (
              <Card className="p-4">
                <Skeleton className="h-16 w-full rounded" />
                <div className="mt-4 flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </Card>
            ) : audioUrl ? (
              <AudioPlayer
                ref={audioPlayerRef}
                audioUrl={audioUrl}
                onTimeUpdate={handleAudioTimeUpdate}
              />
            ) : (
              <Card className="p-4 text-center text-[var(--text-muted)]">
                Failed to load audio file
              </Card>
            )}
          </>
        )}
        <Card className="p-6">
          <div className="border-b border-[var(--border-subtle)] pb-3 mb-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              Transcript
            </h3>
          </div>
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
            {transcript.fullTranscript}
          </p>
        </Card>
      </div>
    );
  }

  // No content state (legacy)
  if (!transcript && !audioFile) {
    return (
      <Card className="p-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-4 text-[var(--text-muted)]">
            <FileAudio className="h-8 w-8" />
            <FileText className="h-8 w-8" />
          </div>
          <div>
            <p className="text-[var(--text-secondary)]">No transcript or audio file</p>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Upload files to view the transcript
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Audio Player - Fixed at top of this view */}
      {audioFile && (
        <div className="shrink-0 pb-4">
          {isLoadingAudio ? (
            <Card className="p-4">
              <Skeleton className="h-16 w-full rounded" />
              <div className="mt-4 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            </Card>
          ) : audioUrl ? (
            <AudioPlayer
              ref={audioPlayerRef}
              audioUrl={audioUrl}
              onTimeUpdate={handleAudioTimeUpdate}
            />
          ) : (
            <Card className="p-4 text-center text-[var(--text-muted)]">
              Failed to load audio file
            </Card>
          )}
        </div>
      )}

      {/* Transcript - Scrollable within remaining space */}
      {transcript ? (
        <Card className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="border-b border-[var(--border-subtle)] p-4 shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                Transcript
              </h3>
              <span className="text-[12px] text-[var(--text-muted)]">
                {segments.length} segments
              </span>
            </div>
            {transcript.speakerMapping && Object.keys(transcript.speakerMapping).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(transcript.speakerMapping).map(([key, speaker]) => (
                  <span
                    key={key}
                    className="inline-flex items-center rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
                  >
                    {key}: {speaker}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <DiarizedTranscript
              segments={segments}
              activeIndex={activeIndex}
              onSegmentClick={handleSegmentClick}
            />
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
          <p className="mt-4 text-[var(--text-secondary)]">No transcript available</p>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Upload a transcript file to view
          </p>
        </Card>
      )}
    </div>
  );
}
