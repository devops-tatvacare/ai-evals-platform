import type { TranscriptSegment, SegmentCritique } from './index';

/**
 * Type of alignment between original and AI segments
 */
export type AlignmentType = 
  | 'matched'       // Both original and AI exist with good overlap
  | 'original-only' // Original exists but no AI segment covers this time
  | 'ai-only'       // AI segment exists but no original for this time
  | 'partial';      // Overlap exists but below confidence threshold

/**
 * A unified time range in seconds
 */
export interface TimeRange {
  start: number;
  end: number;
}

/**
 * An aligned pair of segments with metadata
 */
export interface AlignedSegment {
  /** Unique index for this aligned pair */
  index: number;
  /** Time range this alignment covers (in seconds) */
  timeRange: TimeRange;
  /** Original transcript segment, if any */
  original: TranscriptSegment | null;
  /** AI-generated transcript segment, if any */
  ai: TranscriptSegment | null;
  /** Type of alignment */
  alignmentType: AlignmentType;
  /** Confidence score 0-1 based on time overlap */
  overlapScore: number;
  /** Critique for this segment pair, if available */
  critique?: SegmentCritique;
}

/**
 * Result of segment alignment operation
 */
export interface AlignmentResult {
  /** Aligned segment pairs, sorted by time */
  segments: AlignedSegment[];
  /** Summary statistics */
  stats: {
    totalAligned: number;
    matchedCount: number;
    originalOnlyCount: number;
    aiOnlyCount: number;
    partialCount: number;
    averageOverlapScore: number;
  };
  /** Whether fallback estimation was used due to missing timestamps */
  usedFallback: boolean;
}

// ──────────────────────────────────────────
// Timeline normalization types
// ──────────────────────────────────────────

export type SliceCoverage = 'covered' | 'gap';

/**
 * An atomic time interval between two consecutive boundary points.
 * Used by the timeline normalizer to show many-to-one / one-to-many relationships.
 */
export interface TimelineSlice {
  /** Index of this slice in the timeline */
  index: number;
  /** Time range for this slice */
  timeRange: TimeRange;
  /** Original segment covering this slice, if any */
  original: TranscriptSegment | null;
  /** AI segment covering this slice, if any */
  ai: TranscriptSegment | null;
  /** Whether the original side is covered or a gap */
  originalCoverage: SliceCoverage;
  /** Whether the AI side is covered or a gap */
  aiCoverage: SliceCoverage;
  /** True if this slice is the first in a span of the same original segment */
  isOriginalSpanStart: boolean;
  /** Number of consecutive slices this original segment spans */
  originalSpanLength: number;
  /** True if this slice is the first in a span of the same AI segment */
  isAiSpanStart: boolean;
  /** Number of consecutive slices this AI segment spans */
  aiSpanLength: number;
  /** Critique for this slice, if available (mapped via original segment index) */
  critique?: SegmentCritique;
}

/**
 * Result container from the timeline normalizer
 */
export interface TimelineResult {
  /** Ordered slices forming the unified time grid */
  slices: TimelineSlice[];
  /** Summary statistics */
  stats: {
    totalSlices: number;
    coveredBothCount: number;
    originalGapCount: number;
    aiGapCount: number;
    bothGapCount: number;
  };
  /** Sorted unique time boundary points (in seconds) */
  boundaries: number[];
  /** Whether fallback estimation was used due to missing timestamps */
  usedFallback: boolean;
}
