/**
 * Timestamp Parser
 * Normalizes various timestamp formats to seconds
 */

/**
 * Parse a timestamp string to seconds
 * Handles formats: "MM:SS", "HH:MM:SS", "SS", "SS.ms", numeric values
 */
export function parseTimestamp(ts: string | number | undefined | null): number | null {
  if (ts === undefined || ts === null) return null;
  
  // Already a number
  if (typeof ts === 'number') {
    return isNaN(ts) ? null : ts;
  }
  
  const str = String(ts).trim();
  if (!str) return null;
  
  // Try parsing as plain number (seconds or seconds.ms)
  const asNumber = parseFloat(str);
  if (!isNaN(asNumber) && !str.includes(':')) {
    return asNumber;
  }
  
  // Parse MM:SS or HH:MM:SS format
  const parts = str.split(':');
  if (parts.length === 2) {
    // MM:SS
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    if (!isNaN(minutes) && !isNaN(seconds)) {
      return minutes * 60 + seconds;
    }
  } else if (parts.length === 3) {
    // HH:MM:SS
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  
  return null;
}

/**
 * Format seconds back to MM:SS or HH:MM:SS string
 */
export function formatSecondsToTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Check if a segment has valid parseable timestamps
 */
export function hasValidTimestamps(startTime: string | undefined, endTime: string | undefined): boolean {
  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);
  return start !== null && end !== null && end >= start;
}

/**
 * Estimate segment duration based on array position
 * Used as fallback when timestamps are missing
 */
export function estimateSegmentTimes(
  index: number,
  totalSegments: number,
  totalDuration: number = 300 // default 5 minutes if unknown
): { start: number; end: number } {
  const segmentDuration = totalDuration / totalSegments;
  return {
    start: index * segmentDuration,
    end: (index + 1) * segmentDuration,
  };
}
