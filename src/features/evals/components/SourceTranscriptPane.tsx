import { useEffect, useRef, useMemo, memo } from 'react';
import { FileText } from 'lucide-react';

interface SourceTranscriptPaneProps {
  transcript: string;
  highlightSnippet?: string;
}

/**
 * Left pane of the three-pane inspector showing the source transcript
 * with highlight support for evidence snippets.
 */
export const SourceTranscriptPane = memo(function SourceTranscriptPane({
  transcript,
  highlightSnippet,
}: SourceTranscriptPaneProps) {
  const highlightRef = useRef<HTMLSpanElement>(null);

  // Auto-scroll to highlighted text when it changes
  useEffect(() => {
    if (highlightSnippet && highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightSnippet]);

  // Find and split transcript around the highlight snippet
  const renderedContent = useMemo(() => {
    if (!highlightSnippet || !transcript) {
      return <span>{transcript}</span>;
    }

    // Try to find the snippet in the transcript (case-insensitive)
    const normalizedTranscript = transcript.toLowerCase();
    const normalizedSnippet = highlightSnippet.toLowerCase().trim();
    const index = normalizedTranscript.indexOf(normalizedSnippet);

    if (index === -1) {
      // Snippet not found - just show transcript
      return <span>{transcript}</span>;
    }

    // Split and render with highlight
    const before = transcript.slice(0, index);
    const match = transcript.slice(index, index + highlightSnippet.trim().length);
    const after = transcript.slice(index + highlightSnippet.trim().length);

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
  }, [transcript, highlightSnippet]);

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
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <h3 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Source Transcript
        </h3>
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
