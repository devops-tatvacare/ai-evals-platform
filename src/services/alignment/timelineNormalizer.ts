/**
 * Timeline Normalizer
 * Creates a unified time grid from original and AI transcript segments,
 * exposing gaps and many-to-one / one-to-many relationships.
 */

import type { TranscriptSegment, SegmentCritique } from '@/types';
import type { TimeRange, TimelineSlice, TimelineResult, SliceCoverage } from '@/types/alignment.types';
import { parseTimestamp, estimateSegmentTimes } from './timestampParser';

interface ParsedSeg {
  segment: TranscriptSegment;
  start: number;
  end: number;
  originalIndex: number;
}

/**
 * Parse an array of transcript segments into start/end seconds.
 * Falls back to estimated times when timestamps are missing.
 */
function parseSegmentArray(
  segments: TranscriptSegment[],
  estimatedDuration: number
): { parsed: ParsedSeg[]; usedFallback: boolean } {
  let usedFallback = false;

  const parsed = segments.map((segment, index) => {
    let start = parseTimestamp(segment.startTime);
    let end = parseTimestamp(segment.endTime);

    if (start === null && segment.startSeconds !== undefined) {
      start = segment.startSeconds;
    }
    if (end === null && segment.endSeconds !== undefined) {
      end = segment.endSeconds;
    }

    if (start === null || end === null || end < start) {
      usedFallback = true;
      const estimated = estimateSegmentTimes(index, segments.length, estimatedDuration);
      start = start ?? estimated.start;
      end = end ?? estimated.end;
    }

    return { segment, start, end, originalIndex: index };
  });

  return { parsed, usedFallback };
}

/**
 * Find which parsed segment covers a given slice range.
 * A segment covers a slice when seg.start <= slice.start AND seg.end >= slice.end
 * (with a small epsilon tolerance for floating point).
 */
function findCoveringSegment(
  sliceStart: number,
  sliceEnd: number,
  segments: ParsedSeg[]
): ParsedSeg | null {
  const eps = 0.01;
  for (const seg of segments) {
    if (seg.start <= sliceStart + eps && seg.end >= sliceEnd - eps) {
      return seg;
    }
  }
  return null;
}

const EMPTY_RESULT: TimelineResult = {
  slices: [],
  stats: { totalSlices: 0, coveredBothCount: 0, originalGapCount: 0, aiGapCount: 0, bothGapCount: 0 },
  boundaries: [],
  usedFallback: false,
};

/**
 * Build a unified timeline from original and AI segments.
 *
 * 1. Parse all segments to seconds
 * 2. Collect every unique start/end time → sorted boundary array
 * 3. Create slices between consecutive boundaries (skip zero-width)
 * 4. For each slice, find which original/AI segment covers it
 * 5. Compute span groups for visual grouping
 * 6. Map critiques via original segment index
 */
export function normalizeTimeline(
  originalSegments: TranscriptSegment[],
  aiSegments: TranscriptSegment[],
  critiques?: SegmentCritique[],
  estimatedDuration: number = 300
): TimelineResult {
  if (originalSegments.length === 0 && aiSegments.length === 0) {
    return EMPTY_RESULT;
  }

  // Step 1: Parse segments
  const { parsed: parsedOrig, usedFallback: origFallback } = parseSegmentArray(
    originalSegments,
    estimatedDuration
  );
  const { parsed: parsedAi, usedFallback: aiFallback } = parseSegmentArray(
    aiSegments,
    estimatedDuration
  );
  const usedFallback = origFallback || aiFallback;

  // Step 2: Collect unique boundary points
  const boundarySet = new Set<number>();
  for (const seg of parsedOrig) {
    boundarySet.add(seg.start);
    boundarySet.add(seg.end);
  }
  for (const seg of parsedAi) {
    boundarySet.add(seg.start);
    boundarySet.add(seg.end);
  }

  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

  if (boundaries.length < 2) {
    return { ...EMPTY_RESULT, boundaries, usedFallback };
  }

  // Step 3: Build critique map
  const critiqueMap = new Map<number, SegmentCritique>();
  critiques?.forEach((c) => critiqueMap.set(c.segmentIndex, c));

  // Step 4: Create slices between consecutive boundary points
  const slices: TimelineSlice[] = [];
  let sliceIndex = 0;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];

    // Skip zero-width slices
    if (end - start < 0.001) continue;

    const timeRange: TimeRange = { start, end };
    const origMatch = findCoveringSegment(start, end, parsedOrig);
    const aiMatch = findCoveringSegment(start, end, parsedAi);

    const originalCoverage: SliceCoverage = origMatch ? 'covered' : 'gap';
    const aiCoverage: SliceCoverage = aiMatch ? 'covered' : 'gap';

    // Map critique via original segment index
    const critique = origMatch ? critiqueMap.get(origMatch.originalIndex) : undefined;

    slices.push({
      index: sliceIndex++,
      timeRange,
      original: origMatch?.segment ?? null,
      ai: aiMatch?.segment ?? null,
      originalCoverage,
      aiCoverage,
      // Span fields filled in next step
      isOriginalSpanStart: false,
      originalSpanLength: 0,
      isAiSpanStart: false,
      aiSpanLength: 0,
      critique,
    });
  }

  // Step 5: Compute span groups
  // For the original side: consecutive slices with the same segment form a span
  computeSpanGroups(slices, 'original');
  computeSpanGroups(slices, 'ai');

  // Step 6: Calculate stats
  let coveredBothCount = 0;
  let originalGapCount = 0;
  let aiGapCount = 0;
  let bothGapCount = 0;

  for (const slice of slices) {
    if (slice.originalCoverage === 'covered' && slice.aiCoverage === 'covered') {
      coveredBothCount++;
    } else if (slice.originalCoverage === 'gap' && slice.aiCoverage === 'gap') {
      bothGapCount++;
    } else if (slice.originalCoverage === 'gap') {
      originalGapCount++;
    } else {
      aiGapCount++;
    }
  }

  return {
    slices,
    stats: {
      totalSlices: slices.length,
      coveredBothCount,
      originalGapCount,
      aiGapCount,
      bothGapCount,
    },
    boundaries,
    usedFallback,
  };
}

/**
 * Walk through slices and mark span starts + lengths for one side (original or ai).
 * Consecutive slices that reference the exact same TranscriptSegment object form a span.
 */
function computeSpanGroups(slices: TimelineSlice[], side: 'original' | 'ai'): void {
  let spanStart = 0;

  while (spanStart < slices.length) {
    const current = side === 'original' ? slices[spanStart].original : slices[spanStart].ai;

    if (current === null) {
      // Gap slice — each gap is its own "span" of length 1
      if (side === 'original') {
        slices[spanStart].isOriginalSpanStart = true;
        slices[spanStart].originalSpanLength = 1;
      } else {
        slices[spanStart].isAiSpanStart = true;
        slices[spanStart].aiSpanLength = 1;
      }
      spanStart++;
      continue;
    }

    // Find how many consecutive slices share the same segment reference
    let spanEnd = spanStart + 1;
    while (spanEnd < slices.length) {
      const next = side === 'original' ? slices[spanEnd].original : slices[spanEnd].ai;
      if (next !== current) break;
      spanEnd++;
    }

    const spanLength = spanEnd - spanStart;

    // Mark the first slice as span start
    if (side === 'original') {
      slices[spanStart].isOriginalSpanStart = true;
      slices[spanStart].originalSpanLength = spanLength;
    } else {
      slices[spanStart].isAiSpanStart = true;
      slices[spanStart].aiSpanLength = spanLength;
    }

    // Mark continuation slices
    for (let i = spanStart + 1; i < spanEnd; i++) {
      if (side === 'original') {
        slices[i].isOriginalSpanStart = false;
        slices[i].originalSpanLength = 0;
      } else {
        slices[i].isAiSpanStart = false;
        slices[i].aiSpanLength = 0;
      }
    }

    spanStart = spanEnd;
  }
}
