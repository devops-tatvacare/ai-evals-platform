/**
 * Script Detector Service
 * Detects the writing system (Devanagari, Arabic, CJK, etc.) from transcript text.
 * Uses Unicode ranges from the scripts registry for ~25 writing systems.
 */

import { SCRIPTS } from '@/constants/scripts';
import type { TranscriptData, TranscriptSegment } from '@/types';
import type { ScriptDetectionResult, DetectedScript } from '@/types';

/**
 * Counts the characters in each detected script range.
 */
function countScriptCharacters(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let total = 0;

  for (const char of text) {
    for (const script of SCRIPTS) {
      if (script.id === 'auto') continue;
      if (script.unicodeRanges.some((r) => r.test(char))) {
        counts[script.id] = (counts[script.id] || 0) + 1;
        total++;
        break; // First match wins
      }
    }
  }

  counts._total = total;
  return counts;
}

/**
 * Determines the dominant script from character counts.
 * Returns the script with >50% of script characters, or 'mixed' / 'unknown'.
 */
function determineScript(counts: Record<string, number>): {
  script: DetectedScript;
  confidence: number;
} {
  const total = counts._total || 0;

  if (total === 0) {
    return { script: 'unknown', confidence: 0 };
  }

  // Find the script with the highest count
  let topScript = 'unknown';
  let topCount = 0;
  let secondCount = 0;

  for (const [script, count] of Object.entries(counts)) {
    if (script === '_total') continue;
    if (count > topCount) {
      secondCount = topCount;
      topCount = count;
      topScript = script;
    } else if (count > secondCount) {
      secondCount = count;
    }
  }

  const topRatio = topCount / total;

  // If >70% is one script, it's dominant
  if (topRatio > 0.7) {
    // Special case: if >90% Latin with no other script, mark as 'latin' (was 'english')
    return { script: topScript, confidence: topRatio };
  }

  // If two scripts both have >25%, it's mixed
  const secondRatio = secondCount / total;
  if (topRatio > 0.25 && secondRatio > 0.25) {
    return { script: 'mixed', confidence: Math.min(topRatio, secondRatio) * 2 };
  }

  // Default to the top script
  return { script: topScript, confidence: topRatio };
}

/**
 * Detects the script type from a single text segment
 */
export function detectSegmentScript(text: string): {
  script: DetectedScript;
  confidence: number;
} {
  const counts = countScriptCharacters(text);
  return determineScript(counts);
}

/**
 * Detects the overall script type from an entire transcript
 * Analyzes all segments and returns the primary script
 */
export function detectTranscriptScript(transcript: TranscriptData): ScriptDetectionResult {
  if (!transcript.segments || transcript.segments.length === 0) {
    return {
      primaryScript: 'unknown',
      confidence: 0,
      segmentBreakdown: [],
    };
  }

  const segmentBreakdown: Array<{ segmentIndex: number; detectedScript: DetectedScript }> = [];
  const scriptCounts: Record<string, number> = {};

  let totalConfidence = 0;

  // Analyze each segment
  transcript.segments.forEach((segment: TranscriptSegment, index: number) => {
    const { script, confidence } = detectSegmentScript(segment.text);
    segmentBreakdown.push({ segmentIndex: index, detectedScript: script });
    scriptCounts[script] = (scriptCounts[script] || 0) + 1;
    totalConfidence += confidence;
  });

  const totalSegments = transcript.segments.length;

  // Determine primary script by majority
  let primaryScript: DetectedScript = 'unknown';
  let maxCount = 0;

  for (const [script, count] of Object.entries(scriptCounts)) {
    if (count > maxCount) {
      maxCount = count;
      primaryScript = script;
    }
  }

  // Check for significant mixing (>30% different scripts)
  const mixedThreshold = totalSegments * 0.3;
  const nonPrimaryCount = totalSegments - maxCount;
  if (nonPrimaryCount > mixedThreshold && primaryScript !== 'mixed') {
    primaryScript = 'mixed';
  }

  return {
    primaryScript,
    confidence: totalConfidence / totalSegments,
    segmentBreakdown,
  };
}

/**
 * Checks if two transcripts have matching scripts.
 * Treats 'latin' as compatible with the legacy 'english'/'romanized' values.
 */
export function scriptsMatch(
  script1: ScriptDetectionResult,
  script2: ScriptDetectionResult
): boolean {
  const normalize = (s: DetectedScript): string => {
    if (s === 'english' || s === 'romanized') return 'latin';
    return s;
  };

  return normalize(script1.primaryScript) === normalize(script2.primaryScript);
}
