import { useState, useMemo, memo } from 'react';
import { Card, Badge, SegmentAudioPlayer } from '@/components/ui';
import { useSegmentAudio } from '@/hooks';
import { AlertTriangle, CheckCircle, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { 
  TranscriptData, 
  TranscriptSegment, 
  SegmentCritique, 
  EvaluationCritique,
  CritiqueSeverity,
  EvaluationStatistics 
} from '@/types';

interface SegmentComparisonTableProps {
  original: TranscriptData;
  llmGenerated: TranscriptData;
  critique?: EvaluationCritique;
  audioFileId?: string;
}

type SeverityFilter = 'all' | CritiqueSeverity;

/**
 * Format time for display
 */
function formatTime(time?: string | number): string {
  if (time === undefined || time === null) return '--:--';
  if (typeof time === 'string') return time;
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
 * Individual segment row
 */
interface SegmentRowProps {
  original: TranscriptSegment;
  aiGenerated?: TranscriptSegment;
  critique?: SegmentCritique;
  audioReady: boolean;
  audioLoading: boolean;
  isPlayingThis: boolean;
  onPlaySegment: () => void;
  onStopPlayback: () => void;
}

const SegmentRow = memo(function SegmentRow({
  original,
  aiGenerated,
  critique,
  audioReady,
  audioLoading,
  isPlayingThis,
  onPlaySegment,
  onStopPlayback,
}: SegmentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const severity = critique?.severity || 'none';
  const config = SEVERITY_CONFIG[severity];
  const hasDiscrepancy = critique && critique.discrepancy && critique.discrepancy !== 'Match';
  
  // Row background based on severity
  const rowBg = severity === 'critical' 
    ? 'bg-[var(--color-error-light)]/30' 
    : severity === 'moderate'
    ? 'bg-[var(--color-warning-light)]/30'
    : severity === 'minor'
    ? 'bg-[var(--color-info-light)]/20'
    : '';

  return (
    <div className={`border-b border-[var(--border-subtle)] ${rowBg}`}>
      {/* Main row */}
      <div className="grid grid-cols-[auto_80px_1fr_1fr_120px] gap-3 px-4 py-3 items-start">
        {/* Play button */}
        <div className="pt-0.5">
          <SegmentAudioPlayer
            isPlaying={isPlayingThis}
            isLoading={audioLoading}
            isReady={audioReady}
            onPlay={onPlaySegment}
            onStop={onStopPlayback}
          />
        </div>
        
        {/* Time */}
        <div className="text-[11px] font-mono text-[var(--text-muted)] pt-0.5">
          {formatTime(original.startTime)}
          <br />
          {formatTime(original.endTime)}
        </div>
        
        {/* Original */}
        <div>
          <Badge variant="neutral" className="text-[9px] mb-1">
            {original.speaker}
          </Badge>
          <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">
            {original.text}
          </p>
        </div>
        
        {/* AI Generated */}
        <div>
          {aiGenerated ? (
            <>
              <Badge variant="primary" className="text-[9px] mb-1">
                {aiGenerated.speaker}
              </Badge>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                {aiGenerated.text}
              </p>
            </>
          ) : (
            <span className="text-[12px] italic text-[var(--text-muted)]">—</span>
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
  } = useSegmentAudio({ audioFileId });

  // Build critique map by segment index
  const critiqueMap = useMemo(() => {
    const map = new Map<number, SegmentCritique>();
    critique?.segments.forEach(seg => {
      map.set(seg.segmentIndex, seg);
    });
    return map;
  }, [critique?.segments]);

  // Filter segments based on severity
  const filteredIndices = useMemo(() => {
    const maxSegments = Math.max(original.segments.length, llmGenerated.segments.length);
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
  }, [original.segments.length, llmGenerated.segments.length, severityFilter, critiqueMap]);

  // Count by severity for filter badges
  const severityCounts = useMemo(() => {
    const counts = { none: 0, minor: 0, moderate: 0, critical: 0 };
    const maxSegments = Math.max(original.segments.length, llmGenerated.segments.length);
    
    for (let i = 0; i < maxSegments; i++) {
      const segCritique = critiqueMap.get(i);
      const severity = segCritique?.severity || 'none';
      counts[severity]++;
    }
    
    return counts;
  }, [original.segments.length, llmGenerated.segments.length, critiqueMap]);

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <h4 className="font-medium text-[var(--text-primary)]">Segment Comparison</h4>
        
        {/* Severity filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSeverityFilter('all')}
            className={`px-2 py-1 rounded text-[10px] transition-colors ${
              severityFilter === 'all' 
                ? 'bg-[var(--color-brand-primary)] text-white' 
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
            }`}
          >
            All ({original.segments.length})
          </button>
          {severityCounts.critical > 0 && (
            <button
              onClick={() => setSeverityFilter('critical')}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                severityFilter === 'critical' 
                  ? 'bg-[var(--color-error)] text-white' 
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
                  ? 'bg-[var(--color-warning)] text-white' 
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
                  ? 'bg-[var(--color-info)] text-white' 
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
                ? 'bg-[var(--color-success)] text-white' 
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
      
      {/* Overall assessment */}
      {critique?.overallAssessment && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 px-4 py-2">
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            <strong className="text-[var(--text-primary)]">Assessment:</strong> {critique.overallAssessment}
          </p>
        </div>
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
        {filteredIndices.length === 0 ? (
          <div className="px-4 py-8 text-center text-[var(--text-muted)] text-[13px]">
            No segments match the selected filter
          </div>
        ) : (
          filteredIndices.map((index) => {
            const segment = original.segments[index];
            const segmentId = `ai-eval-segment-${index}`;
            return (
              <SegmentRow
                key={index}
                original={segment || { speaker: '', text: '', startTime: '', endTime: '' }}
                aiGenerated={llmGenerated.segments[index]}
                critique={critiqueMap.get(index)}
                audioReady={audioReady}
                audioLoading={audioLoading}
                isPlayingThis={playingSegmentId === segmentId}
                onPlaySegment={() => segment && playSegment(segmentId, segment.startTime || 0, segment.endTime || 0)}
                onStopPlayback={stopPlayback}
              />
            );
          })
        )}
      </div>
    </Card>
  );
}
