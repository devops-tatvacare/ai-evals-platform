/**
 * Segment Aligner
 * Matches original and AI transcript segments by timestamp overlap
 */

import type { TranscriptSegment, SegmentCritique } from '@/types';
import type { AlignedSegment, AlignmentResult, TimeRange, AlignmentType } from '@/types/alignment.types';
import { parseTimestamp, estimateSegmentTimes } from './timestampParser';

/** Minimum overlap ratio to consider segments matched */
const MATCH_THRESHOLD = 0.3;

/** Minimum overlap ratio for partial match */
const PARTIAL_THRESHOLD = 0.1;

/** Tolerance in seconds for matching zero-duration segments */
const POINT_TOLERANCE = 1.5;

interface ParsedSegment {
  segment: TranscriptSegment;
  start: number;
  end: number;
  index: number;
}

/**
 * Calculate overlap between two time ranges
 * Returns overlap duration and ratio relative to the first range
 * Handles zero-duration segments by using point-in-time proximity
 */
function calculateOverlap(
  range1: TimeRange,
  range2: TimeRange
): { duration: number; ratio: number } {
  const range1Duration = range1.end - range1.start;
  const range2Duration = range2.end - range2.start;
  
  // Handle zero-duration or point segments
  // If either segment has zero/tiny duration, use proximity-based matching
  if (range1Duration < 0.5 || range2Duration < 0.5) {
    const point1 = (range1.start + range1.end) / 2;
    const point2 = (range2.start + range2.end) / 2;
    const distance = Math.abs(point1 - point2);
    
    // If points are within tolerance, consider it a match
    if (distance <= POINT_TOLERANCE) {
      // Score inversely proportional to distance (closer = higher score)
      const ratio = 1 - (distance / POINT_TOLERANCE);
      return { duration: 0, ratio: Math.max(0.5, ratio) }; // Minimum 0.5 to ensure match
    }
    return { duration: 0, ratio: 0 };
  }
  
  const overlapStart = Math.max(range1.start, range2.start);
  const overlapEnd = Math.min(range1.end, range2.end);
  const overlapDuration = Math.max(0, overlapEnd - overlapStart);
  
  const ratio = range1Duration > 0 ? overlapDuration / range1Duration : 0;
  
  return { duration: overlapDuration, ratio };
}

/**
 * Parse segments array into time-indexed structures
 * Falls back to estimated times if timestamps are missing
 */
function parseSegments(
  segments: TranscriptSegment[],
  estimatedDuration: number
): { parsed: ParsedSegment[]; usedFallback: boolean } {
  let usedFallback = false;
  
  const parsed = segments.map((segment, index) => {
    let start = parseTimestamp(segment.startTime);
    let end = parseTimestamp(segment.endTime);
    
    // Use startSeconds/endSeconds if available and main timestamps failed
    if (start === null && segment.startSeconds !== undefined) {
      start = segment.startSeconds;
    }
    if (end === null && segment.endSeconds !== undefined) {
      end = segment.endSeconds;
    }
    
    // Fallback to estimation
    if (start === null || end === null || end < start) {
      usedFallback = true;
      const estimated = estimateSegmentTimes(index, segments.length, estimatedDuration);
      start = start ?? estimated.start;
      end = end ?? estimated.end;
    }
    
    return {
      segment,
      start,
      end,
      index,
    };
  });
  
  return { parsed, usedFallback };
}

/**
 * Find the best matching AI segment for an original segment
 */
function findBestMatch(
  original: ParsedSegment,
  aiSegments: ParsedSegment[],
  usedAiIndices: Set<number>
): { match: ParsedSegment | null; overlapScore: number } {
  let bestMatch: ParsedSegment | null = null;
  let bestScore = 0;
  
  const origRange: TimeRange = { start: original.start, end: original.end };
  
  for (const ai of aiSegments) {
    // Allow reuse of AI segments for multiple originals if they overlap
    const aiRange: TimeRange = { start: ai.start, end: ai.end };
    const { ratio } = calculateOverlap(origRange, aiRange);
    
    if (ratio > bestScore) {
      bestScore = ratio;
      bestMatch = ai;
    }
  }
  
  // Mark as used if it's a good match
  if (bestMatch && bestScore >= MATCH_THRESHOLD) {
    usedAiIndices.add(bestMatch.index);
  }
  
  return { match: bestMatch, overlapScore: bestScore };
}

/**
 * Main alignment function
 * Aligns original and AI segments by timestamp overlap
 */
export function alignSegments(
  originalSegments: TranscriptSegment[],
  aiSegments: TranscriptSegment[],
  critiques?: SegmentCritique[],
  estimatedDuration: number = 300
): AlignmentResult {
  // Handle edge cases
  if (originalSegments.length === 0 && aiSegments.length === 0) {
    return {
      segments: [],
      stats: {
        totalAligned: 0,
        matchedCount: 0,
        originalOnlyCount: 0,
        aiOnlyCount: 0,
        partialCount: 0,
        averageOverlapScore: 0,
      },
      usedFallback: false,
    };
  }
  
  // Parse segments with timestamps
  const { parsed: parsedOriginals, usedFallback: origFallback } = parseSegments(
    originalSegments,
    estimatedDuration
  );
  const { parsed: parsedAi, usedFallback: aiFallback } = parseSegments(
    aiSegments,
    estimatedDuration
  );
  
  const usedFallback = origFallback || aiFallback;
  const usedAiIndices = new Set<number>();
  const aligned: AlignedSegment[] = [];
  
  // Build critique map by segment index (from LLM response)
  const critiqueMap = new Map<number, SegmentCritique>();
  critiques?.forEach((c) => critiqueMap.set(c.segmentIndex, c));
  
  // Step 1: Match each original segment to best AI segment
  for (const orig of parsedOriginals) {
    const { match, overlapScore } = findBestMatch(orig, parsedAi, usedAiIndices);
    
    let alignmentType: AlignmentType;
    if (!match || overlapScore < PARTIAL_THRESHOLD) {
      alignmentType = 'original-only';
    } else if (overlapScore >= MATCH_THRESHOLD) {
      alignmentType = 'matched';
    } else {
      alignmentType = 'partial';
    }
    
    aligned.push({
      index: orig.index,
      timeRange: { start: orig.start, end: orig.end },
      original: orig.segment,
      ai: match?.segment || null,
      alignmentType,
      overlapScore,
      critique: critiqueMap.get(orig.index),
    });
  }
  
  // Step 2: Add AI-only segments (those not matched to any original)
  for (const ai of parsedAi) {
    if (!usedAiIndices.has(ai.index)) {
      // Check if this AI segment has any overlap with originals
      let hasAnyOverlap = false;
      for (const orig of parsedOriginals) {
        const { ratio } = calculateOverlap(
          { start: ai.start, end: ai.end },
          { start: orig.start, end: orig.end }
        );
        if (ratio >= PARTIAL_THRESHOLD) {
          hasAnyOverlap = true;
          break;
        }
      }
      
      if (!hasAnyOverlap) {
        aligned.push({
          index: originalSegments.length + ai.index, // Unique index
          timeRange: { start: ai.start, end: ai.end },
          original: null,
          ai: ai.segment,
          alignmentType: 'ai-only',
          overlapScore: 0,
          critique: undefined,
        });
      }
    }
  }
  
  // Sort by time
  aligned.sort((a, b) => a.timeRange.start - b.timeRange.start);
  
  // Re-index after sorting
  aligned.forEach((seg, idx) => {
    seg.index = idx;
  });
  
  // Calculate stats
  const stats = {
    totalAligned: aligned.length,
    matchedCount: aligned.filter((s) => s.alignmentType === 'matched').length,
    originalOnlyCount: aligned.filter((s) => s.alignmentType === 'original-only').length,
    aiOnlyCount: aligned.filter((s) => s.alignmentType === 'ai-only').length,
    partialCount: aligned.filter((s) => s.alignmentType === 'partial').length,
    averageOverlapScore:
      aligned.length > 0
        ? aligned.reduce((sum, s) => sum + s.overlapScore, 0) / aligned.length
        : 0,
  };
  
  return { segments: aligned, stats, usedFallback };
}

/**
 * Convenience function to check if alignment quality is acceptable
 */
export function isAlignmentReliable(result: AlignmentResult): boolean {
  return (
    !result.usedFallback &&
    result.stats.averageOverlapScore >= MATCH_THRESHOLD &&
    result.stats.aiOnlyCount < result.stats.totalAligned * 0.3
  );
}
