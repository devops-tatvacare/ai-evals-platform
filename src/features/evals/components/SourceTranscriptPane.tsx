import { useEffect, useRef, useMemo, useState, memo } from 'react';
import { FileText, ChevronDown } from 'lucide-react';
import type { DetectedScript } from '@/types';

interface SourceTranscriptPaneProps {
  transcript: string;
  /** Prioritized list of strings to try highlighting in the transcript. First match wins. */
  highlightCandidates?: string[];
  normalizedTranscript?: string;
  normalizationMeta?: {
    enabled: boolean;
    sourceScript: DetectedScript;
    targetScript: string;
  };
}

// ---------------------------------------------------------------------------
// Matching helper
// ---------------------------------------------------------------------------

interface MatchResult {
  index: number;
  length: number;
  candidate: string;
}

/**
 * Try each candidate against the text (case-insensitive).
 * Returns the first match found, or null.
 */
function findBestMatch(
  candidates: string[],
  text: string,
): MatchResult | null {
  const lowerText = text.toLowerCase();

  for (const candidate of candidates) {
    const needle = candidate.toLowerCase().trim();
    if (!needle || needle.length < 2) continue;

    const index = lowerText.indexOf(needle);
    if (index !== -1) {
      return { index, length: candidate.trim().length, candidate };
    }
  }

  // Fuzzy fallback: try first 20 chars of each candidate
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Left pane of the three-pane inspector showing the source transcript
 * with highlight support for evidence snippets and normalization toggle.
 */
export const SourceTranscriptPane = memo(function SourceTranscriptPane({
  transcript,
  highlightCandidates,
  normalizedTranscript,
  normalizationMeta,
}: SourceTranscriptPaneProps) {
  const highlightRef = useRef<HTMLSpanElement>(null);
  const [showOriginalScript, setShowOriginalScript] = useState(false);

  // Determine which transcript version to display
  const displayedTranscript = useMemo(() => {
    if (!normalizationMeta?.enabled || !normalizedTranscript) {
      return transcript;
    }
    return showOriginalScript ? transcript : normalizedTranscript;
  }, [transcript, normalizedTranscript, normalizationMeta, showOriginalScript]);

  // Try candidates against displayed transcript, then alt version
  const { renderedContent, matchedSnippet } = useMemo(() => {
    if (!highlightCandidates?.length || !displayedTranscript) {
      return { renderedContent: <span>{displayedTranscript}</span>, matchedSnippet: undefined };
    }

    // 1. Try each candidate against the currently displayed transcript
    const match = findBestMatch(highlightCandidates, displayedTranscript);
    if (match) {
      const before = displayedTranscript.slice(0, match.index);
      const highlighted = displayedTranscript.slice(match.index, match.index + match.length);
      const after = displayedTranscript.slice(match.index + match.length);
      return {
        renderedContent: (
          <>
            <span>{before}</span>
            <span
              ref={highlightRef}
              className="bg-[var(--color-warning)]/30 text-[var(--text-primary)] px-0.5 rounded-sm border-b-2 border-[var(--color-warning)]"
            >
              {highlighted}
            </span>
            <span>{after}</span>
          </>
        ),
        matchedSnippet: match.candidate,
      };
    }

    // 2. Try against the other transcript version (if normalization enabled)
    if (normalizedTranscript && normalizationMeta?.enabled) {
      const altTranscript = showOriginalScript ? normalizedTranscript : transcript;
      const altMatch = findBestMatch(highlightCandidates, altTranscript);
      if (altMatch) {
        return {
          renderedContent: (
            <>
              <span>{displayedTranscript}</span>
              <div className="mt-2 p-2 rounded bg-[var(--color-info)]/10 border border-[var(--color-info)]/20">
                <p className="text-[10px] text-[var(--color-info)]">
                  Evidence found in the {showOriginalScript ? 'normalized' : 'original'} version. Toggle to see highlight.
                </p>
              </div>
            </>
          ),
          matchedSnippet: altMatch.candidate,
        };
      }
    }

    // 3. Nothing matched
    return { renderedContent: <span>{displayedTranscript}</span>, matchedSnippet: undefined };
  }, [displayedTranscript, highlightCandidates, transcript, normalizedTranscript, normalizationMeta, showOriginalScript]);

  // Auto-scroll to highlighted text when match changes
  useEffect(() => {
    if (matchedSnippet && highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [matchedSnippet, displayedTranscript]);

  if (!transcript) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-4">
        <FileText className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm text-center">No transcript available</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 min-h-[37px] flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between w-full">
          <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Source Transcript
          </h3>
          {/* Normalization toggle */}
          {normalizationMeta?.enabled && normalizedTranscript && (
            <button
              type="button"
              onClick={() => setShowOriginalScript(!showOriginalScript)}
              className="group flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium text-[var(--text-brand)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-subtle)]"
              title={showOriginalScript
                ? `Showing original (${normalizationMeta.sourceScript}). Click for normalized (${normalizationMeta.targetScript}).`
                : `Showing normalized (${normalizationMeta.targetScript}). Click for original (${normalizationMeta.sourceScript}).`
              }
            >
              <span className="font-semibold">
                {showOriginalScript ? 'Original' : 'Normalized'}
              </span>
              <ChevronDown className="h-2.5 w-2.5 group-hover:translate-y-0.5 transition-transform" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed font-mono">
          {renderedContent}
        </div>
      </div>

      {/* Highlight indicator */}
      {matchedSnippet && (
        <div className="px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--color-warning)]/10">
          <p className="text-[10px] text-[var(--color-warning)] truncate">
            Highlighting: &ldquo;{matchedSnippet.slice(0, 50)}{matchedSnippet.length > 50 ? '...' : ''}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
});
