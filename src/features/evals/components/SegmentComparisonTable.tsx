import { useState, useMemo, memo, useCallback } from 'react';
import { Card, Badge, SegmentAudioPlayer } from '@/components/ui';
import { useSegmentAudio } from '@/hooks';
import { AlertTriangle, CheckCircle, HelpCircle, ChevronDown, ChevronRight, AlertCircle, ExternalLink } from 'lucide-react';
import type { 
  TranscriptData, 
  EvaluationCritique,
  CritiqueSeverity,
  EvaluationStatistics,
  AlignedSegment,
  AlignmentResult,
  AssessmentReference,
} from '@/types';
import { alignSegments } from '@/services/alignment';
import { formatSecondsToTimestamp } from '@/services/alignment/timestampParser';

interface SegmentComparisonTableProps {
  original: TranscriptData;
  llmGenerated: TranscriptData;
  critique?: EvaluationCritique;
  audioFileId?: string;
}

type SeverityFilter = 'all' | CritiqueSeverity;

/**
 * Format time for display - handles both string timestamps and seconds
 */
function formatTime(time?: string | number): string {
  if (time === undefined || time === null) return '--:--';
  if (typeof time === 'number') return formatSecondsToTimestamp(time);
  if (typeof time === 'string') return time;
  return '--:--';
}

/**
 * Severity badge configuration
 */
const SEVERITY_CONFIG: Record<CritiqueSeverity, { 
  variant: 'success' | 'primary' | 'warning' | 'error'; 
  label: string;
  icon: typeof CheckCircle;
}> = {
  none: { variant: 'success', label: 'Match', icon: CheckCircle },
  minor: { variant: 'primary', label: 'Minor', icon: AlertTriangle },
  moderate: { variant: 'warning', label: 'Moderate', icon: AlertTriangle },
  critical: { variant: 'error', label: 'Critical', icon: AlertTriangle },
};

/**
 * Statistics summary bar
 */
const StatisticsSummary = memo(function StatisticsSummary({ 
  stats 
}: { 
  stats: EvaluationStatistics 
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px]">
      <span className="text-[var(--text-muted)]">
        {stats.totalSegments} segments
      </span>
      <span className="flex items-center gap-1 text-[var(--color-success)]">
        <CheckCircle className="h-3 w-3" />
        {stats.matchCount} match
      </span>
      {stats.minorCount > 0 && (
        <span className="text-[var(--color-info)]">
          {stats.minorCount} minor
        </span>
      )}
      {stats.moderateCount > 0 && (
        <span className="text-[var(--color-warning)]">
          {stats.moderateCount} moderate
        </span>
      )}
      {stats.criticalCount > 0 && (
        <span className="text-[var(--color-error)]">
          {stats.criticalCount} critical
        </span>
      )}
      {stats.unclearCount > 0 && (
        <span className="flex items-center gap-1 text-[var(--text-muted)]">
          <HelpCircle className="h-3 w-3" />
          {stats.unclearCount} unclear
        </span>
      )}
    </div>
  );
});

/**
 * Clickable assessment reference that scrolls to the segment
 */
const AssessmentReferenceChip = memo(function AssessmentReferenceChip({
  reference,
  onNavigate,
}: {
  reference: AssessmentReference;
  onNavigate: (segmentIndex: number) => void;
}) {
  const severityColors: Record<CritiqueSeverity, string> = {
    none: 'bg-[var(--color-success-light)] text-[var(--color-success)] border-[var(--color-success)]/30',
    minor: 'bg-[var(--color-info-light)] text-[var(--color-info)] border-[var(--color-info)]/30',
    moderate: 'bg-[var(--color-warning-light)] text-[var(--color-warning)] border-[var(--color-warning)]/30',
    critical: 'bg-[var(--color-error-light)] text-[var(--color-error)] border-[var(--color-error)]/30',
  };

  return (
    <button
      type="button"
      onClick={() => onNavigate(reference.segmentIndex)}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-all hover:scale-105 hover:shadow-sm ${severityColors[reference.severity]}`}
      title={`Go to segment ${reference.segmentIndex + 1}: ${reference.issue}`}
    >
      <span className="font-mono">[{reference.timeWindow}]</span>
      <span className="max-w-[200px] truncate">{reference.issue}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
    </button>
  );
});

/**
 * Overall assessment with clickable segment references
 */
const OverallAssessmentSection = memo(function OverallAssessmentSection({
  assessment,
  references,
  onNavigateToSegment,
}: {
  assessment: string;
  references?: AssessmentReference[];
  onNavigateToSegment: (segmentIndex: number) => void;
}) {
  const hasReferences = references && references.length > 0;
  
  // Group references by severity for better organization
  const groupedReferences = useMemo(() => {
    if (!references) return null;
    const groups: Record<CritiqueSeverity, AssessmentReference[]> = {
      critical: [],
      moderate: [],
      minor: [],
      none: [],
    };
    references.forEach(ref => {
      groups[ref.severity].push(ref);
    });
    return groups;
  }, [references]);

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 px-4 py-3">
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
        <strong className="text-[var(--text-primary)]">Assessment:</strong> {assessment}
      </p>
      
      {hasReferences && groupedReferences && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Quick Navigation — Click to jump to segment
          </p>
          <div className="flex flex-wrap gap-1.5">
            {/* Critical first, then moderate, then minor */}
            {groupedReferences.critical.map((ref, idx) => (
              <AssessmentReferenceChip
                key={`critical-${idx}`}
                reference={ref}
                onNavigate={onNavigateToSegment}
              />
            ))}
            {groupedReferences.moderate.map((ref, idx) => (
              <AssessmentReferenceChip
                key={`moderate-${idx}`}
                reference={ref}
                onNavigate={onNavigateToSegment}
              />
            ))}
            {groupedReferences.minor.map((ref, idx) => (
              <AssessmentReferenceChip
                key={`minor-${idx}`}
                reference={ref}
                onNavigate={onNavigateToSegment}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Individual segment row - now uses AlignedSegment for proper time matching
 */
interface SegmentRowProps {
  aligned: AlignedSegment;
  audioReady: boolean;
  audioLoading: boolean;
  isPlayingThis: boolean;
  canPlay: boolean;
  onPlaySegment: () => void;
  onStopPlayback: () => void;
}

const SegmentRow = memo(function SegmentRow({
  aligned,
  audioReady,
  audioLoading,
  isPlayingThis,
  canPlay,
  onPlaySegment,
  onStopPlayback,
}: SegmentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { original, ai, critique, alignmentType, overlapScore, timeRange } = aligned;
  const severity = critique?.severity || 'none';
  const config = SEVERITY_CONFIG[severity];
  const hasDiscrepancy = critique && critique.discrepancy && critique.discrepancy !== 'Match';
  
  // Show alignment warning for poor matches
  const showAlignmentWarning = alignmentType === 'partial' || alignmentType === 'original-only' || alignmentType === 'ai-only';
  
  // Row background based on severity and alignment
  const rowBg = alignmentType === 'ai-only' || alignmentType === 'original-only'
    ? 'bg-[var(--color-warning-light)]/20'
    : severity === 'critical' 
    ? 'bg-[var(--color-error-light)]/30' 
    : severity === 'moderate'
    ? 'bg-[var(--color-warning-light)]/30'
    : severity === 'minor'
    ? 'bg-[var(--color-info-light)]/20'
    : '';

  return (
    <div 
      id={`ai-eval-segment-${aligned.index}`}
      className={`border-b border-[var(--border-subtle)] transition-all duration-300 ${rowBg}`}
    >
      {/* Main row */}
      <div className="grid grid-cols-[auto_80px_1fr_1fr_120px] gap-3 px-4 py-3 items-start">
        {/* Play button - only show if segment can be played */}
        <div className="pt-0.5">
          {canPlay ? (
            <SegmentAudioPlayer
              isPlaying={isPlayingThis}
              isLoading={audioLoading}
              isReady={audioReady}
              onPlay={onPlaySegment}
              onStop={onStopPlayback}
            />
          ) : (
            <div className="w-6 h-6" /> // Placeholder for alignment
          )}
        </div>
        
        {/* Time - now using aligned timeRange */}
        <div className="text-[11px] font-mono text-[var(--text-muted)] pt-0.5">
          {formatTime(timeRange.start)}
          <br />
          {formatTime(timeRange.end)}
          {showAlignmentWarning && overlapScore < 0.5 && (
            <div className="mt-1" title={`Alignment: ${alignmentType}, overlap: ${Math.round(overlapScore * 100)}%`}>
              <AlertCircle className="h-3 w-3 text-[var(--color-warning)]" />
            </div>
          )}
        </div>
        
        {/* Original */}
        <div>
          {original ? (
            <>
              <Badge variant="neutral" className="text-[9px] mb-1">
                {original.speaker}
              </Badge>
              <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">
                {original.text}
              </p>
            </>
          ) : (
            <span className="text-[12px] italic text-[var(--text-muted)]">— (no original)</span>
          )}
        </div>
        
        {/* AI Generated */}
        <div>
          {ai ? (
            <>
              <Badge variant="primary" className="text-[9px] mb-1">
                {ai.speaker}
              </Badge>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                {ai.text}
              </p>
            </>
          ) : (
            <span className="text-[12px] italic text-[var(--text-muted)]">— (no AI match)</span>
          )}
        </div>
        
        {/* Severity & expand */}
        <div className="flex items-start gap-2">
          <Badge variant={config.variant} className="text-[9px]">
            {config.label}
          </Badge>
          {hasDiscrepancy && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
      
      {/* Expanded critique details */}
      {isExpanded && critique && hasDiscrepancy && (
        <div className="px-4 pb-3 ml-[calc(24px+80px+1.5rem)]">
          <div className="rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {critique.likelyCorrect && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                  Likely correct: <strong>{critique.likelyCorrect}</strong>
                </span>
              )}
              {critique.confidence && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  {critique.confidence} confidence
                </span>
              )}
              {critique.category && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  {critique.category}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              {critique.discrepancy}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Main comparison table component
 */
export function SegmentComparisonTable({
  original,
  llmGenerated,
  critique,
  audioFileId,
}: SegmentComparisonTableProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  
  const {
    isLoading: audioLoading,
    isReady: audioReady,
    playingSegmentId,
    playSegment,
    stopPlayback,
    canPlaySegment,
  } = useSegmentAudio({ audioFileId });

  // Perform timestamp-based alignment of original and AI segments
  const alignmentResult: AlignmentResult = useMemo(() => {
    return alignSegments(
      original.segments,
      llmGenerated.segments,
      critique?.segments
    );
  }, [original.segments, llmGenerated.segments, critique?.segments]);

  // Filter aligned segments based on severity
  const filteredSegments = useMemo(() => {
    if (severityFilter === 'all') {
      return alignmentResult.segments;
    }
    return alignmentResult.segments.filter(seg => {
      const severity = seg.critique?.severity || 'none';
      return severity === severityFilter;
    });
  }, [alignmentResult.segments, severityFilter]);

  // Count by severity for filter badges
  const severityCounts = useMemo(() => {
    const counts = { none: 0, minor: 0, moderate: 0, critical: 0 };
    for (const seg of alignmentResult.segments) {
      const severity = seg.critique?.severity || 'none';
      counts[severity]++;
    }
    return counts;
  }, [alignmentResult.segments]);

  // Handler to scroll to a specific segment
  const handleNavigateToSegment = useCallback((segmentIndex: number) => {
    // Reset filter to 'all' so the segment is visible
    setSeverityFilter('all');
    
    // Small delay to allow filter change to render
    setTimeout(() => {
      const element = document.getElementById(`ai-eval-segment-${segmentIndex}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add a highlight effect
        element.classList.add('ring-2', 'ring-[var(--color-brand-primary)]', 'ring-offset-2');
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-[var(--color-brand-primary)]', 'ring-offset-2');
        }, 2000);
      }
    }, 100);
  }, []);

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-[var(--text-primary)]">Segment Comparison</h4>
          {alignmentResult.usedFallback && (
            <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]" title="Some segments have missing timestamps - using estimated alignment">
              ⚠ Estimated
            </span>
          )}
        </div>
        
        {/* Severity filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSeverityFilter('all')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              severityFilter === 'all' 
                ? 'bg-[var(--color-brand-primary)] text-[var(--text-on-color)]' 
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
            }`}
          >
            All ({alignmentResult.segments.length})
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
      
      {/* Statistics summary */}
      {critique?.statistics && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2">
          <StatisticsSummary stats={critique.statistics} />
        </div>
      )}
      
      {/* Overall assessment with clickable references */}
      {critique?.overallAssessment && (
        <OverallAssessmentSection
          assessment={critique.overallAssessment}
          references={critique.assessmentReferences}
          onNavigateToSegment={handleNavigateToSegment}
        />
      )}
      
      {/* Column headers */}
      <div className="grid grid-cols-[auto_80px_1fr_1fr_120px] gap-3 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
        <span className="w-6" /> {/* Play button space */}
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Time</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Original</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">AI Generated</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Status</span>
      </div>
      
      {/* Segment rows */}
      <div className="max-h-[calc(100vh-320px)] min-h-[400px] overflow-auto">
        {filteredSegments.length === 0 ? (
          <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[13px]">
            No segments match the selected filter
          </div>
        ) : (
          filteredSegments.map((aligned) => {
            const segmentId = `ai-eval-segment-${aligned.index}`;
            const segmentCanPlay = canPlaySegment(aligned.timeRange.start, aligned.timeRange.end);
            return (
              <SegmentRow
                key={aligned.index}
                aligned={aligned}
                audioReady={audioReady}
                audioLoading={audioLoading}
                isPlayingThis={playingSegmentId === segmentId}
                canPlay={segmentCanPlay}
                onPlaySegment={() => {
                  if (segmentCanPlay) {
                    playSegment(segmentId, aligned.timeRange.start, aligned.timeRange.end);
                  }
                }}
                onStopPlayback={stopPlayback}
              />
            );
          })
        )}
      </div>
    </Card>
  );
}
