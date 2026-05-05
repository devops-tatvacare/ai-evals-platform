export interface MatchResult {
  index: number;
  length: number;
  candidate: string;
}

/**
 * Try each candidate against the text (case-insensitive).
 * Returns the first match found, or null. Falls back to a fuzzy
 * first-20-chars lookup for long candidates that may have minor
 * trailing drift between the LLM-extracted quote and the transcript.
 */
export function findBestMatch(candidates: string[], text: string): MatchResult | null {
  const lowerText = text.toLowerCase();

  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().trim();
    if (!needle || needle.length < 2) continue;

    const index = lowerText.indexOf(needle);
    if (index !== -1) {
      return { index, length: candidate.trim().length, candidate };
    }
  }

  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().trim();
    if (needle.length <= 20) continue;

    const partial = needle.slice(0, 20);
    const index = lowerText.indexOf(partial);
    if (index !== -1) {
      return {
        index,
        length: Math.min(candidate.trim().length, text.length - index),
        candidate,
      };
    }
  }

  return null;
}
