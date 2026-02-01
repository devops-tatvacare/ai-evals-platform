import { useState, useCallback, memo } from 'react';
import { Check, X, Loader2, Edit3, CheckCircle } from 'lucide-react';
import { Card, Button, Badge, SegmentAudioPlayer, Modal } from '@/components/ui';
import { useHumanEvaluation } from '../hooks/useHumanEvaluation';
import { useSegmentAudio } from '@/hooks';
import { EditDistanceBadge } from './EditDistanceBadge';
import { SegmentCritiqueCard } from './SegmentCritiqueCard';
import type { Listing, TranscriptSegment, SegmentCritique } from '@/types';

interface HumanEvalNotepadProps {
  listing: Listing;
}

interface SegmentRowProps {
  index: number;
  original: TranscriptSegment;
  aiGenerated?: TranscriptSegment;
  correction?: string;
  critique?: SegmentCritique;
  onCorrect: (index: number, text: string) => void;
  onRemoveCorrection: (index: number) => void;
  // Audio playback props
  audioReady: boolean;
  audioLoading: boolean;
  isPlayingThis: boolean;
  onPlaySegment: () => void;
  onStopPlayback: () => void;
}

/**
 * Format time for display - handles both string (HH:MM:SS) and number (seconds) formats
 */
function formatTimeDisplay(startTime?: string | number, endTime?: string | number): string {
  if (!startTime && !endTime) return '';
  
  const formatValue = (val: string | number | undefined): string => {
    if (val === undefined || val === null) return '??';
    if (typeof val === 'string') return val;
    // Convert seconds to HH:MM:SS
    const h = Math.floor(val / 3600);
    const m = Math.floor((val % 3600) / 60);
    const s = Math.floor(val % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };
  
  return `${formatValue(startTime)} - ${formatValue(endTime)}`;
}

const SegmentRow = memo(function SegmentRow({
  index,
  original,
  aiGenerated,
  correction,
  critique,
  onCorrect,
  onRemoveCorrection,
  audioReady,
  audioLoading,
  isPlayingThis,
  onPlaySegment,
  onStopPlayback,
}: SegmentRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(correction || aiGenerated?.text || original.text);

  const handleSave = () => {
    onCorrect(index, editText);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditText(correction || aiGenerated?.text || original.text);
    setIsEditing(false);
  };

  const handleClear = () => {
    onRemoveCorrection(index);
    setEditText(aiGenerated?.text || original.text);
  };

  const hasTimeInfo = original.startTime || original.endTime;

  return (
    <div className="grid grid-cols-3 gap-4 border-b border-[var(--border-subtle)] py-3 last:border-b-0">
      {/* Original */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          {hasTimeInfo && (
            <SegmentAudioPlayer
              isPlaying={isPlayingThis}
              isLoading={audioLoading}
              isReady={audioReady}
              onPlay={onPlaySegment}
              onStop={onStopPlayback}
            />
          )}
          <Badge variant="neutral" className="text-[10px]">
            {original.speaker}
          </Badge>
          {hasTimeInfo && (
            <span className="text-[9px] font-mono text-[var(--text-muted)]">
              {formatTimeDisplay(original.startTime, original.endTime)}
            </span>
          )}
        </div>
        <p className="text-[13px] text-[var(--text-primary)]">{original.text}</p>
      </div>

      {/* AI Generated */}
      <div>
        {aiGenerated ? (
          <>
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="primary" className="text-[10px]">
                {aiGenerated.speaker}
              </Badge>
            </div>
            <p className="text-[13px] text-[var(--text-secondary)]">{aiGenerated.text}</p>
            <EditDistanceBadge 
              original={original.text} 
              generated={aiGenerated.text} 
              className="mt-1.5"
            />
            {critique && <SegmentCritiqueCard critique={critique} />}
          </>
        ) : (
          <p className="text-[13px] italic text-[var(--text-muted)]">No AI segment</p>
        )}
      </div>

      {/* Human Edit */}
      <div>
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
              rows={3}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} className="gap-1">
                <Check className="h-3 w-3" />
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="group cursor-pointer rounded-md p-2 transition-colors hover:bg-[var(--bg-secondary)]"
            onClick={() => setIsEditing(true)}
          >
            {correction ? (
              <div className="flex items-start justify-between">
                <p className="text-[13px] text-[var(--color-success)]">{correction}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  className="opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <p className="text-[13px] italic text-[var(--text-muted)]">
                Click to add correction...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export function HumanEvalNotepad({ listing }: HumanEvalNotepadProps) {
  const {
    evaluation,
    isSaving,
    lastSaved,
    updateNotes,
    updateScore,
    addCorrection,
    removeCorrection,
    markComplete,
  } = useHumanEvaluation(listing);

  const {
    isLoading: audioLoading,
    isReady: audioReady,
    playingSegmentId,
    playSegment,
    stopPlayback,
  } = useSegmentAudio({ audioFileId: listing.audioFile?.id });

  const [notesText, setNotesText] = useState(evaluation?.notes || '');
  const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);

  const handleNotesChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setNotesText(text);
      updateNotes(text);
    },
    [updateNotes]
  );

  const handleCorrect = useCallback(
    (segmentIndex: number, correctedText: string) => {
      const original = listing.transcript?.segments[segmentIndex];
      if (original) {
        addCorrection({
          segmentIndex,
          originalText: original.text,
          correctedText,
        });
      }
    },
    [listing.transcript?.segments, addCorrection]
  );

  const maxSegments = Math.max(
    listing.transcript?.segments.length || 0,
    listing.aiEval?.llmTranscript?.segments.length || 0
  );

  const getCorrection = (index: number) => {
    return evaluation?.corrections.find((c) => c.segmentIndex === index)?.correctedText;
  };

  const getCritique = (index: number) => {
    return listing.aiEval?.critique?.segments.find((c) => c.segmentIndex === index);
  };

  const correctionCount = evaluation?.corrections.length || 0;

  return (
    <div className="space-y-4">
      {/* Compact status strip */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
        {/* Status */}
        <div className="flex items-center gap-2">
          {evaluation?.status === 'completed' ? (
            <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
          ) : (
            <Edit3 className="h-4 w-4 text-[var(--text-muted)]" />
          )}
          <Badge variant={evaluation?.status === 'completed' ? 'success' : 'neutral'} className="text-[10px]">
            {evaluation?.status === 'completed' ? 'Complete' : 'In Progress'}
          </Badge>
        </div>
        
        <div className="h-4 w-px bg-[var(--border-default)]" />
        
        {/* Score */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">Score:</span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {evaluation?.overallScore ? `${evaluation.overallScore}/5` : '—'}
          </span>
        </div>
        
        {/* Corrections count */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">Corrections:</span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {correctionCount}
          </span>
        </div>
        
        {/* Save status */}
        {isSaving && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving...
          </span>
        )}
        {!isSaving && lastSaved && (
          <span className="text-[10px] text-[var(--text-muted)]">
            Saved {lastSaved.toLocaleTimeString()}
          </span>
        )}
        
        {/* Actions - pushed to right */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEvalModalOpen(true)}
            className="h-7 text-[11px] gap-1"
          >
            <Edit3 className="h-3 w-3" />
            Edit Details
          </Button>
          {evaluation?.status !== 'completed' && (
            <Button
              size="sm"
              onClick={markComplete}
              className="h-7 text-[11px] gap-1"
            >
              <Check className="h-3 w-3" />
              Complete
            </Button>
          )}
        </div>
      </div>

      {/* Segment-by-segment comparison - now the main focus */}
      {listing.transcript && (
        <Card className="p-0">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
            <div className="grid grid-cols-3 gap-4">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                Original
              </span>
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                AI Generated
              </span>
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                Human Correction
              </span>
            </div>
          </div>
          <div className="max-h-[calc(100vh-280px)] min-h-[400px] overflow-auto px-4">
            {Array.from({ length: maxSegments }).map((_, index) => {
              const segment = listing.transcript!.segments[index];
              const segmentId = `segment-${index}`;
              return (
                <SegmentRow
                  key={index}
                  index={index}
                  original={segment || { speaker: '', text: '', startSeconds: 0, endSeconds: 0 }}
                  aiGenerated={listing.aiEval?.llmTranscript?.segments[index]}
                  correction={getCorrection(index)}
                  critique={getCritique(index)}
                  onCorrect={handleCorrect}
                  onRemoveCorrection={removeCorrection}
                  audioReady={audioReady}
                  audioLoading={audioLoading}
                  isPlayingThis={playingSegmentId === segmentId}
                  onPlaySegment={() => segment && playSegment(segmentId, segment.startTime || 0, segment.endTime || 0)}
                  onStopPlayback={stopPlayback}
                />
              );
            })}
          </div>
        </Card>
      )}

      {/* Evaluation Details Modal */}
      <Modal
        isOpen={isEvalModalOpen}
        onClose={() => setIsEvalModalOpen(false)}
        title="Human Evaluation Details"
        className="max-w-md"
      >
        <div className="space-y-4">
          {/* Overall Score */}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-[var(--text-primary)]">
              Overall Score (1-5)
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  onClick={() => updateScore(score)}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border text-[14px] font-medium transition-colors ${
                    evaluation?.overallScore === score
                      ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)] text-white'
                      : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--border-focus)]'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-[var(--text-primary)]">
              Evaluation Notes
            </label>
            <textarea
              value={notesText}
              onChange={handleNotesChange}
              placeholder="Add notes about this evaluation..."
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
              rows={4}
            />
          </div>

          {/* Summary */}
          <div className="pt-2 border-t border-[var(--border-subtle)]">
            <div className="flex justify-between text-[12px] text-[var(--text-muted)]">
              <span>Corrections made: {correctionCount}</span>
              {lastSaved && <span>Last saved: {lastSaved.toLocaleTimeString()}</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setIsEvalModalOpen(false)}>
              Close
            </Button>
            {evaluation?.status !== 'completed' && (
              <Button onClick={() => { markComplete(); setIsEvalModalOpen(false); }} className="gap-1">
                <Check className="h-3.5 w-3.5" />
                Mark Complete
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
