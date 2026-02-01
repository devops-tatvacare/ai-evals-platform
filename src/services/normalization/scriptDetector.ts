/**
 * Script Detector Service
 * Detects the script type (Devanagari, Romanized, etc.) from transcript text
 */

import type { TranscriptData, TranscriptSegment } from '@/types';
import type { ScriptDetectionResult, DetectedScript } from '@/types';

// Unicode ranges for script detection
const DEVANAGARI_RANGE = /[\u0900-\u097F]/;
const LATIN_RANGE = /[a-zA-Z]/;

/**
 * Counts the characters in different script ranges
 */
function countScriptCharacters(text: string): {
  devanagari: number;
  latin: number;
  total: number;
} {
  let devanagari = 0;
  let latin = 0;
  let total = 0;

  for (const char of text) {
    if (DEVANAGARI_RANGE.test(char)) {
      devanagari++;
      total++;
    } else if (LATIN_RANGE.test(char)) {
      latin++;
      total++;
    }
  }

  return { devanagari, latin, total };
}

/**
 * Determines the script type from character counts
 */
function determineScript(counts: {
  devanagari: number;
  latin: number;
  total: number;
}): { script: DetectedScript; confidence: number } {
  const { devanagari, latin, total } = counts;

  if (total === 0) {
    return { script: 'unknown', confidence: 0 };
  }

  const devanagariRatio = devanagari / total;
  const latinRatio = latin / total;

  // Primarily Devanagari (>70% Devanagari characters)
  if (devanagariRatio > 0.7) {
    return { script: 'devanagari', confidence: devanagariRatio };
  }

  // Primarily Latin/Romanized (>70% Latin characters)
  if (latinRatio > 0.7) {
    // If >90% Latin, likely pure English
    if (latinRatio > 0.9 && devanagari === 0) {
      return { script: 'english', confidence: latinRatio };
    }
    return { script: 'romanized', confidence: latinRatio };
  }

  // Mixed content (30-70% of either)
  if (devanagariRatio > 0.3 && latinRatio > 0.3) {
    return { script: 'mixed', confidence: Math.min(devanagariRatio, latinRatio) * 2 };
  }

  // Default to romanized if mostly latin
  if (latinRatio > devanagariRatio) {
    return { script: 'romanized', confidence: latinRatio };
  }

  return { script: 'devanagari', confidence: devanagariRatio };
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
  const scriptCounts: Record<DetectedScript, number> = {
    devanagari: 0,
    romanized: 0,
    mixed: 0,
    english: 0,
    unknown: 0,
  };

  let totalConfidence = 0;

  // Analyze each segment
  transcript.segments.forEach((segment: TranscriptSegment, index: number) => {
    const { script, confidence } = detectSegmentScript(segment.text);
    segmentBreakdown.push({ segmentIndex: index, detectedScript: script });
    scriptCounts[script]++;
    totalConfidence += confidence;
  });

  const totalSegments = transcript.segments.length;

  // Determine primary script by majority
  let primaryScript: DetectedScript = 'unknown';
  let maxCount = 0;

  for (const [script, count] of Object.entries(scriptCounts)) {
    if (count > maxCount) {
      maxCount = count;
      primaryScript = script as DetectedScript;
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
 * Checks if two transcripts have matching scripts
 */
export function scriptsMatch(
  script1: ScriptDetectionResult,
  script2: ScriptDetectionResult
): boolean {
  // Consider 'romanized' and 'english' as compatible
  const normalize = (s: DetectedScript): DetectedScript => {
    if (s === 'english') return 'romanized';
    return s;
  };

  return normalize(script1.primaryScript) === normalize(script2.primaryScript);
}
