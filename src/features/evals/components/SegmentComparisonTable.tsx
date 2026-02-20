import { useState, useMemo, memo, useCallback } from 'react';
import { Card, Badge, SegmentAudioPlayer, Tooltip } from '@/components/ui';
import { useSegmentAudio } from '@/hooks';
import { AlertTriangle, CheckCircle, HelpCircle, ChevronDown, ChevronRight, AlertCircle, ExternalLink, GitCompareArrows, Loader2, Info } from 'lucide-react';
import type {
  TranscriptData,
  TranscriptSegment,
  UnifiedCritique,
  CritiqueSeverity,
  EvaluationStatistics,
  AlignedSegment,
  AlignmentResult,
  AssessmentReference,
  DetectedScript,
  SegmentCritique,
} from '@/types';
import type { TimelineSlice, TimelineResult } from '@/types/alignment.types';
import { alignSegments, normalizeTimeline } from '@/services/alignment';
import { formatSecondsToTimestamp } from '@/services/alignment/timestampParser';

interface SegmentComparisonTableProps {
  original: TranscriptData;
  llmGenerated: TranscriptData;
  critique?: UnifiedCritique;
  audioFileId?: string;
  normalizedOriginal?: TranscriptData;
  normalizationMeta?: {
    enabled: boolean;
    sourceScript: DetectedScript;
    targetScript: string;
  };
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
 * Empty timeline result for when timeline mode is off
 */
const EMPTY_TIMELINE: TimelineResult = {
  slices: [],
  stats: { totalSlices: 0, coveredBothCount: 0, originalGapCount: 0, aiGapCount: 0, bothGapCount: 0 },
  boundaries: [],
  usedFallback: false,
};

/**
 * Timeline stats bar shown when timeline mode is active
 */
const TimelineStatsBar = memo(function TimelineStatsBar({ stats }: { stats: TimelineResult['stats'] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2">
      <span className="text-[var(--text-muted)]">
        {stats.totalSlices} slices
      </span>
      <span className="flex items-center gap-1 text-[var(--color-success)]">
        <CheckCircle className="h-3 w-3" />
        {stats.coveredBothCount} covered
      </span>
      {stats.originalGapCount > 0 && (
        <span className="text-[var(--color-warning)]">
          {stats.originalGapCount} original gaps
        </span>
      )}
      {stats.aiGapCount > 0 && (
        <span className="text-[var(--color-info)]">
          {stats.aiGapCount} AI gaps
        </span>
      )}
      {stats.bothGapCount > 0 && (
        <span className="text-[var(--text-muted)]">
          {stats.bothGapCount} both gaps
        </span>
      )}
    </div>
  );
});

/**
 * Gap cell — used for slices where one side has no segment
 */
function GapCell() {
  return (
    <div className="flex items-center h-full">
      <span className="text-[11px] italic text-[var(--text-muted)] px-2 py-1 rounded bg-[repeating-linear-gradient(135deg,var(--bg-tertiary),var(--bg-tertiary)_4px,transparent_4px,transparent_8px)]">
        -- gap --
      </span>
    </div>
  );
}

/**
 * Content cell for a span start — shows speaker badge, text, and span hint
 */
function SpanStartCell({ segment, spanLength, variant }: {
  segment: TranscriptSegment;
  spanLength: number;
  variant: 'neutral' | 'primary';
}) {
  return (
    <div>
      <Badge variant={variant} className="text-[9px] mb-1">
        {segment.speaker}
      </Badge>
      <p className={`text-[12px] leading-relaxed ${variant === 'neutral' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
        {segment.text}
      </p>
      {spanLength > 1 && (
        <span className="text-[9px] text-[var(--text-muted)] mt-0.5 inline-block">
          spans {spanLength} slices
        </span>
      )}
    </div>
  );
}

/**
 * Continuation cell — shown for non-start slices within a span
 */
function ContinuationCell() {
  return (
    <div className="flex items-center h-full">
      <span className="text-[11px] italic text-[var(--text-muted)]">(continued)</span>
    </div>
  );
}

/**
 * Individual timeline slice row
 */
interface TimelineSliceRowProps {
  slice: TimelineSlice;
  audioReady: boolean;
  audioLoading: boolean;
  isPlayingThis: boolean;
  canPlay: boolean;
  onPlaySegment: () => void;
  onStopPlayback: () => void;
}

const TimelineSliceRow = memo(function TimelineSliceRow({
  slice,
  audioReady,
  audioLoading,
  isPlayingThis,
  canPlay,
  onPlaySegment,
  onStopPlayback,
}: TimelineSliceRowProps) {
  const { timeRange, originalCoverage, aiCoverage, isOriginalSpanStart, originalSpanLength, isAiSpanStart, aiSpanLength, critique } = slice;

  const isGap = originalCoverage === 'gap' && aiCoverage === 'gap';
  const isOrigGap = originalCoverage === 'gap';
  const isAiGap = aiCoverage === 'gap';

  // Determine status label and style
  let statusLabel: string;
  let statusClass: string;
  if (isGap) {
    statusLabel = 'Gap';
    statusClass = 'text-[var(--text-muted)]';
  } else if (isOrigGap) {
    statusLabel = 'AI only';
    statusClass = 'text-[var(--color-info)]';
  } else if (isAiGap) {
    statusLabel = 'Orig only';
    statusClass = 'text-[var(--color-warning)]';
  } else if (critique) {
    const config = SEVERITY_CONFIG[critique.severity];
    statusLabel = config.label;
    statusClass = '';
  } else {
    statusLabel = 'Covered';
    statusClass = 'text-[var(--color-success)]';
  }

  // Row background
  const rowBg = isGap
    ? 'bg-[var(--bg-tertiary)]/50'
    : isOrigGap || isAiGap
    ? 'bg-[var(--color-warning-light)]/10'
    : '';

  // Border style: dashed for continuation rows, solid for span starts
  const isAnySpanStart = isOriginalSpanStart || isAiSpanStart;
  const borderStyle = isAnySpanStart
    ? 'border-b border-[var(--border-subtle)]'
    : 'border-b border-dashed border-[var(--border-subtle)]/60';

  return (
    <div
      id={`ai-eval-timeline-${slice.index}`}
      className={`${borderStyle} transition-colors ${rowBg}`}
    >
      <div className="grid grid-cols-[auto_80px_1fr_1fr_120px] gap-3 px-4 py-2 items-start">
        {/* Play button */}
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
            <div className="w-6 h-6" />
          )}
        </div>

        {/* Time */}
        <div className="text-[11px] font-mono text-[var(--text-muted)] pt-0.5">
          {formatTime(timeRange.start)}
          <br />
          {formatTime(timeRange.end)}
        </div>

        {/* Original side */}
        <div>
          {isOrigGap ? (
            <GapCell />
          ) : isOriginalSpanStart && slice.original ? (
            <SpanStartCell segment={slice.original} spanLength={originalSpanLength} variant="neutral" />
          ) : (
            <ContinuationCell />
          )}
        </div>

        {/* AI side */}
        <div>
          {isAiGap ? (
            <GapCell />
          ) : isAiSpanStart && slice.ai ? (
            <SpanStartCell segment={slice.ai} spanLength={aiSpanLength} variant="primary" />
          ) : (
            <ContinuationCell />
          )}
        </div>

        {/* Status */}
        <div>
          {critique && !isOrigGap && !isAiGap ? (
            <Badge variant={SEVERITY_CONFIG[critique.severity].variant} className="text-[9px]">
              {statusLabel}
            </Badge>
          ) : (
            <span className={`text-[10px] font-medium ${statusClass}`}>{statusLabel}</span>
          )}
        </div>
      </div>
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
  normalizedOriginal,
  normalizationMeta,
}: SegmentComparisonTableProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [timelineMode, setTimelineMode] = useState(false);

  // Toggle for showing original vs normalized script
  const [showOriginalScript, setShowOriginalScript] = useState(false);
  
  // Determine which original to display
  const displayedOriginal = useMemo(() => {
    if (!normalizationMeta?.enabled || !normalizedOriginal) {
      return original; // No normalization performed
    }
    return showOriginalScript ? original : normalizedOriginal;
  }, [original, normalizedOriginal, normalizationMeta, showOriginalScript]);
  
  const {
    isLoading: audioLoading,
    isReady: audioReady,
    playingSegmentId,
    playSegment,
    stopPlayback,
    canPlaySegment,
  } = useSegmentAudio({ audioFileId });

  // Perform timestamp-based alignment using displayed original
  const alignmentResult: AlignmentResult = useMemo(() => {
    return alignSegments(
      displayedOriginal.segments,
      llmGenerated.segments,
      critique?.segments as SegmentCritique[] | undefined
    );
  }, [displayedOriginal.segments, llmGenerated.segments, critique?.segments]);

  // Compute timeline normalization (lazy — only when mode is active)
  const timelineResult = useMemo(() => {
    if (!timelineMode) return EMPTY_TIMELINE;
    return normalizeTimeline(
      displayedOriginal.segments,
      llmGenerated.segments,
      critique?.segments as SegmentCritique[] | undefined
    );
  }, [timelineMode, displayedOriginal.segments, llmGenerated.segments, critique?.segments]);

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
        element.classList.add('ring-2', 'ring-[var(--border-brand)]', 'ring-offset-2');
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-[var(--border-brand)]', 'ring-offset-2');
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
          {audioLoading && (
            <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading audio...
            </span>
          )}
          {alignmentResult.usedFallback && (
            <span className="text-[9px] px-2 py-0.5 rounded bg-[var(--color-warning-light)] text-[var(--color-warning)]" title="Some segments have missing timestamps - using estimated alignment">
              ⚠ Estimated
            </span>
          )}
          {/* Timeline toggle */}
          <button
            type="button"
            onClick={() => setTimelineMode(!timelineMode)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              timelineMode
                ? 'bg-[var(--color-brand-primary)] text-[var(--text-on-color)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
            }`}
            title="Toggle timeline alignment view — shows unified time grid with gaps and multi-slice spans"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            Timeline
          </button>
          {timelineMode && (
            <Tooltip
              content={
                <div className="space-y-1.5 text-[11px]">
                  <p className="font-medium">How to read the timeline</p>
                  <p>Each row is a time slice created from the combined boundaries of both transcripts.</p>
                  <div className="space-y-0.5 text-[var(--text-secondary)]">
                    <p><strong>Solid border</strong> — start of a new segment span</p>
                    <p><strong>Dashed border</strong> — continuation of the same segment</p>
                    <p><strong>"spans N slices"</strong> — one segment covers multiple time slices</p>
                    <p><strong>"-- gap --"</strong> — no transcript data for that side in this time range</p>
                  </div>
                  <div className="space-y-0.5 text-[var(--text-secondary)]">
                    <p><span className="text-[var(--color-success)]">Covered</span> — both sides have data</p>
                    <p><span className="text-[var(--color-info)]">AI only</span> — original transcript has a gap</p>
                    <p><span className="text-[var(--color-warning)]">Orig only</span> — AI transcript has a gap</p>
                  </div>
                </div>
              }
              position="bottom"
              maxWidth={320}
            >
              <Info className="h-3.5 w-3.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-help transition-colors" />
            </Tooltip>
          )}
        </div>

        {/* Severity filter — disabled in timeline mode */}
        <div className={`flex items-center gap-1 transition-opacity ${timelineMode ? 'opacity-40 pointer-events-none' : ''}`}>
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
      
      {/* Scrollable area: stats, assessment, column headers (sticky), and segment rows */}
      <div className="max-h-[calc(100vh-320px)] min-h-[400px] overflow-auto">

      {/* Timeline stats bar — shown when timeline mode is active */}
      {timelineMode && timelineResult.slices.length > 0 && (
        <TimelineStatsBar stats={timelineResult.stats} />
      )}

      {/* Statistics summary — hidden in timeline mode */}
      {!timelineMode && critique?.statistics && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2">
          <StatisticsSummary stats={critique.statistics as unknown as EvaluationStatistics} />
        </div>
      )}

      {/* Overall assessment with clickable references — hidden in timeline mode */}
      {!timelineMode && critique?.overallAssessment && (
        <OverallAssessmentSection
          assessment={critique.overallAssessment}
          references={critique.assessmentReferences as AssessmentReference[] | undefined}
          onNavigateToSegment={handleNavigateToSegment}
        />
      )}

      {/* Column headers — sticky within scroll container */}
      <div className="grid grid-cols-[auto_80px_1fr_1fr_120px] gap-3 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] sticky top-0 z-10">
        <span className="w-6" /> {/* Play button space */}
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Time</span>

        {/* Original column with toggle */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-[var(--text-muted)]">Original</span>

          {/* Show toggle only when normalization was performed */}
          {normalizationMeta?.enabled && normalizedOriginal && (
            <button
              type="button"
              onClick={() => setShowOriginalScript(!showOriginalScript)}
              className="group flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium text-[var(--text-brand)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-subtle)]"
              title={showOriginalScript
                ? `Showing ${normalizationMeta.sourceScript} script. Click to show ${normalizationMeta.targetScript}.`
                : `Showing ${normalizationMeta.targetScript}. Click to show ${normalizationMeta.sourceScript} script.`
              }
            >
              {showOriginalScript ? (
                <>
                  <span className="font-semibold">देव</span>
                  <ChevronDown className="h-2.5 w-2.5 group-hover:translate-y-0.5 transition-transform" />
                </>
              ) : (
                <>
                  <span className="font-semibold">ABC</span>
                  <ChevronDown className="h-2.5 w-2.5 group-hover:translate-y-0.5 transition-transform" />
                </>
              )}
            </button>
          )}
        </div>

        <span className="text-[10px] font-medium text-[var(--text-muted)]">AI Generated</span>
        <span className="text-[10px] font-medium text-[var(--text-muted)]">Status</span>
      </div>

      {/* Segment / slice rows — conditional on mode */}
      <div>
        {timelineMode ? (
          // Timeline mode: render slices
          timelineResult.slices.length === 0 ? (
            <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[13px]">
              No timeline slices to display
            </div>
          ) : (
            timelineResult.slices.map((slice) => {
              const sliceId = `ai-eval-timeline-${slice.index}`;
              const sliceCanPlay = canPlaySegment(slice.timeRange.start, slice.timeRange.end);
              return (
                <TimelineSliceRow
                  key={slice.index}
                  slice={slice}
                  audioReady={audioReady}
                  audioLoading={audioLoading}
                  isPlayingThis={playingSegmentId === sliceId}
                  canPlay={sliceCanPlay}
                  onPlaySegment={() => {
                    if (sliceCanPlay) {
                      playSegment(sliceId, slice.timeRange.start, slice.timeRange.end);
                    }
                  }}
                  onStopPlayback={stopPlayback}
                />
              );
            })
          )
        ) : (
          // Normal mode: render aligned segments
          filteredSegments.length === 0 ? (
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
          )
        )}
      </div>
      </div>
    </Card>
  );
}
