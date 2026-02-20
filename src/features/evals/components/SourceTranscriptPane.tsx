import { useEffect, useRef, useMemo, useState, memo } from 'react';
import { FileText, ChevronDown } from 'lucide-react';
import type { DetectedScript } from '@/types';

interface SourceTranscriptPaneProps {
  transcript: string;
  highlightSnippet?: string;
  normalizedTranscript?: string;
  normalizationMeta?: {
    enabled: boolean;
    sourceScript: DetectedScript;
    targetScript: string;
  };
}

/**
 * Left pane of the three-pane inspector showing the source transcript
 * with highlight support for evidence snippets and normalization toggle.
 */
export const SourceTranscriptPane = memo(function SourceTranscriptPane({
  transcript,
  highlightSnippet,
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

  // Auto-scroll to highlighted text when it changes
  useEffect(() => {
    if (highlightSnippet && highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightSnippet, displayedTranscript]);

  // Find and split transcript around the highlight snippet
  const renderedContent = useMemo(() => {
    if (!highlightSnippet || !displayedTranscript) {
      return <span>{displayedTranscript}</span>;
    }

    // Try to find the snippet in the transcript (case-insensitive)
    const normalizedText = displayedTranscript.toLowerCase();
    const normalizedSnippetText = highlightSnippet.toLowerCase().trim();
    let index = normalizedText.indexOf(normalizedSnippetText);

    // Fallback: try matching against the other transcript version if not found
    if (index === -1 && normalizedTranscript && normalizationMeta?.enabled) {
      const altTranscript = showOriginalScript ? normalizedTranscript : transcript;
      const altIndex = altTranscript.toLowerCase().indexOf(normalizedSnippetText);
      if (altIndex !== -1) {
        // Snippet matched in the other version — show indicator
        return (
          <>
            <span>{displayedTranscript}</span>
            <div className="mt-2 p-2 rounded bg-[var(--color-info)]/10 border border-[var(--color-info)]/20">
              <p className="text-[10px] text-[var(--color-info)]">
                Evidence found in {showOriginalScript ? normalizationMeta.targetScript : normalizationMeta.sourceScript} version. Toggle script to see highlight.
              </p>
            </div>
          </>
        );
      }
    }

    if (index === -1) {
      // Try fuzzy fallback: match first 20 chars of snippet
      if (normalizedSnippetText.length > 20) {
        const partial = normalizedSnippetText.slice(0, 20);
        index = normalizedText.indexOf(partial);
      }
    }

    if (index === -1) {
      // Snippet not found - just show transcript
      return <span>{displayedTranscript}</span>;
    }

    // Determine highlight length (use full snippet if found, otherwise partial)
    const highlightLength = normalizedText.indexOf(normalizedSnippetText) !== -1
      ? highlightSnippet.trim().length
      : Math.min(highlightSnippet.trim().length, displayedTranscript.length - index);

    // Split and render with highlight
    const before = displayedTranscript.slice(0, index);
    const match = displayedTranscript.slice(index, index + highlightLength);
    const after = displayedTranscript.slice(index + highlightLength);

    return (
      <>
        <span>{before}</span>
        <span
          ref={highlightRef}
          className="bg-[var(--color-warning)]/30 text-[var(--text-primary)] px-0.5 rounded-sm border-b-2 border-[var(--color-warning)]"
        >
          {match}
        </span>
        <span>{after}</span>
      </>
    );
  }, [displayedTranscript, highlightSnippet, transcript, normalizedTranscript, normalizationMeta, showOriginalScript]);

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
      {/* Header — min-h aligned with Extracted Data pane */}
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
                ? `Showing ${normalizationMeta.sourceScript} script. Click to show ${normalizationMeta.targetScript}.`
                : `Showing ${normalizationMeta.targetScript}. Click to show ${normalizationMeta.sourceScript} script.`
              }
            >
              {showOriginalScript ? (
                <>
                  <span className="font-semibold">देव</span>
                  <ChevronDown className="h-2.5 w-2.5 group-hover:translate-y-0.5 transition-transform" />
                </>
              ) : (
                <>
                  <span className="font-semibold">ABC</span>
                  <ChevronDown className="h-2.5 w-2.5 group-hover:translate-y-0.5 transition-transform" />
                </>
              )}
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
      {highlightSnippet && (
        <div className="px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--color-warning)]/10">
          <p className="text-[10px] text-[var(--color-warning)] truncate">
            Highlighting: "{highlightSnippet.slice(0, 50)}{highlightSnippet.length > 50 ? '...' : ''}"
          </p>
        </div>
      )}
    </div>
  );
});
