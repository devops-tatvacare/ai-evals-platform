import { ApiTranscriptComparison } from './ApiTranscriptComparison';
import { ApiStructuredComparison } from './ApiStructuredComparison';
import type { Listing } from '@/types';

interface ApiEvalsViewProps {
  listing: Listing;
}

export function ApiEvalsView({ listing }: ApiEvalsViewProps) {
  const { aiEval, apiResponse } = listing;

  if (!aiEval || !aiEval.apiCritique || !aiEval.judgeOutput) {
    return (
      <div className="p-8 text-center text-[var(--text-secondary)]">
        <p>No AI evaluation data available for this API listing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Assessment */}
      <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
        <h3 className="font-medium text-[var(--text-primary)] mb-2">Overall Assessment</h3>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          {aiEval.apiCritique.overallAssessment}
        </p>
      </div>

      {/* Transcript Comparison - Collapsible */}
      <ApiTranscriptComparison
        apiTranscript={apiResponse!.input}
        judgeTranscript={aiEval.judgeOutput.transcript}
        critique={aiEval.apiCritique.transcriptComparison}
      />

      {/* Structured Output Comparison - Collapsible */}
      <ApiStructuredComparison comparison={aiEval.apiCritique.structuredComparison} />
    </div>
  );
}
