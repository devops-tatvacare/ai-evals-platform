import { useState, useCallback, useMemo, memo } from 'react';
import { Check, X, Loader2, Edit3, CheckCircle, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Card, Button, Badge, SegmentAudioPlayer, Modal } from '@/components/ui';
import { useHumanEvaluation } from '../hooks/useHumanEvaluation';
import { useSegmentAudio } from '@/hooks';
import { EditDistanceBadge } from './EditDistanceBadge';
import { SegmentCritiqueCard } from './SegmentCritiqueCard';
import type { Listing, TranscriptSegment, SegmentCritique, CritiqueSeverity } from '@/types';

interface HumanEvalNotepadProps {
  listing: Listing;
}

type SeverityFilter = 'all' | CritiqueSeverity;

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
  canPlay: boolean;
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
  canPlay,
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

  const handleAccept = () => {
    // Accept AI generated text as correction
    if (aiGenerated?.text) {
      onCorrect(index, aiGenerated.text);
    }
  };

  const handleReject = () => {
    // Reject and clear correction
    onRemoveCorrection(index);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  // Only show audio player if we have valid time info and can play
  const showAudioPlayer = canPlay;
  const hasTimeInfo = original.startTime !== undefined || original.endTime !== undefined;

  return (
    <div className="grid grid-cols-3 gap-4 border-b border-[var(--border-subtle)] py-3 last:border-b-0">
      {/* Original */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          {showAudioPlayer && (
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
          <div>
            {correction ? (
              <div className="space-y-2">
                <p className="text-[13px] text-[var(--color-success)] p-2 rounded-md bg-[var(--color-success)]/5">
                  {correction}
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleEdit}
                    className="h-7 text-[11px] gap-1"
                    title="Edit correction"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleReject}
                    className="h-7 text-[11px] gap-1 text-[var(--color-error)] hover:text-[var(--color-error)]"
                    title="Remove correction"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                </div>
              </div>
            ) : aiGenerated && critique && critique.severity !== 'none' ? (
              <div className="space-y-2">
                <p className="text-[13px] text-[var(--text-muted)] italic p-2">
                  {aiGenerated.text}
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleAccept}
                    className="h-7 text-[11px] gap-1 text-[var(--color-success)] hover:text-[var(--color-success)]"
                    title="Accept AI critique"
                  >
                    <ThumbsUp className="h-3 w-3" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleReject}
                    className="h-7 text-[11px] gap-1 text-[var(--color-error)] hover:text-[var(--color-error)]"
                    title="Reject AI critique"
                  >
                    <ThumbsDown className="h-3 w-3" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleEdit}
                    className="h-7 text-[11px] gap-1"
                    title="Edit manually"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleEdit}
                className="w-full text-left p-2 rounded-md transition-colors hover:bg-[var(--bg-secondary)]"
              >
                <p className="text-[13px] italic text-[var(--text-muted)]">
                  Click to add correction...
                </p>
              </button>
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
    canPlaySegment,
  } = useSegmentAudio({ audioFileId: listing.audioFile?.id });

  const [notesText, setNotesText] = useState(evaluation?.notes || '');
  const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

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

  // Build critique map for filtering
  const critiqueMap = useMemo(() => {
    const map = new Map<number, SegmentCritique>();
    listing.aiEval?.critique?.segments.forEach(seg => {
      map.set(seg.segmentIndex, seg);
    });
    return map;
  }, [listing.aiEval?.critique?.segments]);

  // Count by severity for filter chips
  const severityCounts = useMemo(() => {
    const counts = { none: 0, minor: 0, moderate: 0, critical: 0 };
    
    for (let i = 0; i < maxSegments; i++) {
      const segCritique = critiqueMap.get(i);
      const severity = segCritique?.severity || 'none';
      counts[severity]++;
    }
    
    return counts;
  }, [maxSegments, critiqueMap]);

  // Filter segments based on severity
  const filteredIndices = useMemo(() => {
    const indices: number[] = [];
    
    for (let i = 0; i < maxSegments; i++) {
      if (severityFilter === 'all') {
        indices.push(i);
      } else {
        const segCritique = critiqueMap.get(i);
        const severity = segCritique?.severity || 'none';
        if (severity === severityFilter) {
          indices.push(i);
        }
      }
    }
    
    return indices;
  }, [maxSegments, severityFilter, critiqueMap]);

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
            {/* Filter chips row */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[13px] font-medium text-[var(--text-primary)]">Segment Comparison</h4>
              
              {/* Severity filter chips */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSeverityFilter('all')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    severityFilter === 'all' 
                      ? 'bg-[var(--color-brand-primary)] text-[var(--text-on-color)]' 
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  }`}
                >
                  All ({maxSegments})
                </button>
                {severityCounts.critical > 0 && (
                  <button
                    onClick={() => setSeverityFilter('critical')}
                    className={`px-2 py-1 rounded text-[10px] transition-colors ${
                      severityFilter === 'critical' 
                        ? 'bg-[var(--color-error)] text-[var(--text-on-color)]' 
                        : 'bg-[var(--color-error-light)] text-[var(--color-error)] hover:bg-[var(--color-error)]/20'
                    }`}
                  >
                    Critical ({severityCounts.critical})
                  </button>
                )}
                {severityCounts.moderate > 0 && (
                  <button
                    onClick={() => setSeverityFilter('moderate')}
                    className={`px-2 py-1 rounded text-[10px] transition-colors ${
                      severityFilter === 'moderate' 
                        ? 'bg-[var(--color-warning)] text-[var(--text-on-color)]' 
                        : 'bg-[var(--color-warning-light)] text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20'
                    }`}
                  >
                    Moderate ({severityCounts.moderate})
                  </button>
                )}
                {severityCounts.minor > 0 && (
                  <button
                    onClick={() => setSeverityFilter('minor')}
                    className={`px-2 py-1 rounded text-[10px] transition-colors ${
                      severityFilter === 'minor' 
                        ? 'bg-[var(--color-info)] text-[var(--text-on-color)]' 
                        : 'bg-[var(--color-info-light)] text-[var(--color-info)] hover:bg-[var(--color-info)]/20'
                    }`}
                  >
                    Minor ({severityCounts.minor})
                  </button>
                )}
                <button
                  onClick={() => setSeverityFilter('none')}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    severityFilter === 'none' 
                      ? 'bg-[var(--color-success)] text-[var(--text-on-color)]' 
                      : 'bg-[var(--color-success-light)] text-[var(--color-success)] hover:bg-[var(--color-success)]/20'
                  }`}
                >
                  Match ({severityCounts.none})
                </button>
              </div>
            </div>
            
            {/* Column headers */}
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
            {filteredIndices.map((index) => {
              const segment = listing.transcript!.segments[index];
              const segmentId = `human-eval-segment-${index}`;
              const segmentCanPlay = segment && canPlaySegment(segment.startTime, segment.endTime);
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
                  canPlay={!!segmentCanPlay}
                  onPlaySegment={() => {
                    if (segment && segmentCanPlay) {
                      playSegment(segmentId, segment.startTime!, segment.endTime!);
                    }
                  }}
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
                      ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)] text-[var(--text-on-color)]'
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
