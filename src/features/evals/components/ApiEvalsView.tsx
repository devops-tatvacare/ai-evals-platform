import { useState } from 'react';
import { LayoutList, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui';
import { ApiTranscriptComparison } from './ApiTranscriptComparison';
import { ApiStructuredComparison } from './ApiStructuredComparison';
import { SemanticAuditView } from './SemanticAuditView';
import type { Listing } from '@/types';

type ViewMode = 'classic' | 'inspector';

interface ApiEvalsViewProps {
  listing: Listing;
}

export function ApiEvalsView({ listing }: ApiEvalsViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('inspector');
  const { aiEval, apiResponse } = listing;

  // Check if we have all required data
  if (!aiEval || !apiResponse) {
    return (
      <div className="p-8 text-center text-[var(--text-secondary)]">
        <p>No evaluation data available. Run AI evaluation first.</p>
      </div>
    );
  }

  // Check if evaluation is complete with API critique data
  if (!aiEval.apiCritique?.transcriptComparison || !aiEval.apiCritique?.structuredComparison) {
    return (
      <div className="p-8 text-center text-[var(--text-secondary)]">
        <p>Evaluation data incomplete. Please re-run the AI evaluation.</p>
      </div>
    );
  }

  if (!aiEval.judgeOutput) {
    return (
      <div className="p-8 text-center text-[var(--text-secondary)]">
        <p>Judge output not available. Please re-run the AI evaluation.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* View mode toggle */}
      <div className="flex justify-end mb-3 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          <Button
            variant={viewMode === 'inspector' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('inspector')}
            className="h-7 px-2 gap-1.5"
            title="Three-pane inspector view"
          >
            <Columns3 className="h-3.5 w-3.5" />
            <span className="text-xs">Inspector</span>
          </Button>
          <Button
            variant={viewMode === 'classic' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('classic')}
            className="h-7 px-2 gap-1.5"
            title="Classic list view"
          >
            <LayoutList className="h-3.5 w-3.5" />
            <span className="text-xs">Classic</span>
          </Button>
        </div>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'inspector' ? (
        <div className="flex-1 min-h-[500px] border border-[var(--border-primary)] rounded-lg overflow-hidden">
          <SemanticAuditView listing={listing} />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overall Assessment */}
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
            <h3 className="font-medium text-[var(--text-primary)] mb-2">Overall Assessment</h3>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {aiEval.apiCritique.overallAssessment || 'No assessment available.'}
            </p>
          </div>

          {/* Transcript Comparison - Collapsible */}
          <ApiTranscriptComparison
            apiTranscript={apiResponse.input}
            judgeTranscript={aiEval.judgeOutput.transcript}
            critique={aiEval.apiCritique.transcriptComparison}
          />

          {/* Structured Output Comparison - Collapsible */}
          <ApiStructuredComparison comparison={aiEval.apiCritique.structuredComparison} />
        </div>
      )}
    </div>
  );
}
