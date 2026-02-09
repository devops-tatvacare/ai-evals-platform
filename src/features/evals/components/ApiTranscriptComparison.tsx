import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApiEvaluationCritique, DetectedScript } from '@/types';

interface ApiTranscriptComparisonProps {
  apiTranscript: string;
  judgeTranscript: string;
  critique: ApiEvaluationCritique['transcriptComparison'];
  normalizedApiTranscript?: string;
  normalizationMeta?: {
    enabled: boolean;
    sourceScript: DetectedScript;
    targetScript: string;
  };
}

export function ApiTranscriptComparison({
  apiTranscript,
  judgeTranscript,
  critique,
  normalizedApiTranscript,
  normalizationMeta,
}: ApiTranscriptComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showOriginalScript, setShowOriginalScript] = useState(false);

  const getMatchColor = (match: number) => {
    if (match >= 90) return 'text-[var(--color-success)]';
    if (match >= 70) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-error)]';
  };

  // Defensive check for critique data
  const overallMatch = critique?.overallMatch ?? 0;
  const critiqueText = critique?.critique || 'No critique available.';

  // Toggle between original and normalized API transcript
  const displayedApiTranscript = useMemo(() => {
    if (!normalizationMeta?.enabled || !normalizedApiTranscript) {
      return apiTranscript;
    }
    return showOriginalScript ? apiTranscript : normalizedApiTranscript;
  }, [apiTranscript, normalizedApiTranscript, normalizationMeta, showOriginalScript]);

  // Use judge transcript from critique if prop is empty
  const displayedJudgeTranscript = useMemo(() => {
    if (judgeTranscript) return judgeTranscript;
    return critique?.judgeTranscript || '';
  }, [judgeTranscript, critique?.judgeTranscript]);

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
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                  API Transcript
                </h4>
                {/* Normalization toggle */}
                {normalizationMeta?.enabled && normalizedApiTranscript && (
                  <button
                    type="button"
                    onClick={() => setShowOriginalScript(!showOriginalScript)}
                    className="group flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium text-[var(--color-brand-primary)] hover:bg-[var(--bg-hover)] transition-colors border border-[var(--border-subtle)]"
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
              <div className="p-3 bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)] text-sm whitespace-pre-wrap max-h-64 overflow-auto font-mono">
                {displayedApiTranscript || <span className="italic text-[var(--text-muted)]">No transcript available</span>}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wide">
                Judge Transcript
              </h4>
              <div className="p-3 bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)] text-sm whitespace-pre-wrap max-h-64 overflow-auto font-mono">
                {displayedJudgeTranscript || <span className="italic text-[var(--text-muted)]">No judge transcript available</span>}
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
