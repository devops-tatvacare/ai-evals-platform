import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApiEvaluationCritique } from '@/types';

interface ApiTranscriptComparisonProps {
  apiTranscript: string;
  judgeTranscript: string;
  critique: ApiEvaluationCritique['transcriptComparison'];
}

export function ApiTranscriptComparison({
  apiTranscript,
  judgeTranscript,
  critique,
}: ApiTranscriptComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const getMatchColor = (match: number) => {
    if (match >= 90) return 'text-[var(--color-success)]';
    if (match >= 70) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-error)]';
  };

  // Defensive check for critique data
  const overallMatch = critique?.overallMatch ?? 0;
  const critiqueText = critique?.critique || 'No critique available.';

  return (
    <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          )}
          <span className="font-medium text-[var(--text-primary)]">Transcript Comparison</span>
        </div>
        <span className={`text-sm font-medium ${getMatchColor(overallMatch)}`}>
          {overallMatch}% match
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wide">
                API Transcript
              </h4>
              <div className="p-3 bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)] text-sm whitespace-pre-wrap max-h-64 overflow-auto font-mono">
                {apiTranscript}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wide">
                Judge Transcript
              </h4>
              <div className="p-3 bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)] text-sm whitespace-pre-wrap max-h-64 overflow-auto font-mono">
                {judgeTranscript}
              </div>
            </div>
          </div>

          {/* Critique */}
          <div className="p-3 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20 rounded">
            <p className="text-sm text-[var(--text-primary)]">{critiqueText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
