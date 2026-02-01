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
