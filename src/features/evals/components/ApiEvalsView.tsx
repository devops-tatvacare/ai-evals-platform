import { useState } from 'react';
import { LayoutList, Columns3, FlaskConical, AlertCircle } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';
import { ApiTranscriptComparison } from './ApiTranscriptComparison';
import { ApiStructuredComparison } from './ApiStructuredComparison';
import { SemanticAuditView } from './SemanticAuditView';
import type { Listing, AIEvaluation } from '@/types';

type ViewMode = 'classic' | 'inspector';

interface ApiEvalsViewProps {
  listing: Listing;
  aiEval?: AIEvaluation | null;
}

export function ApiEvalsView({ listing, aiEval }: ApiEvalsViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('inspector');
  const { apiResponse } = listing;

  // Check if we have all required data
  if (!aiEval || !apiResponse) {
    return (
      <div className="flex-1 min-h-full flex items-center justify-center p-8">
        <EmptyState
          icon={FlaskConical}
          title="No evaluation data yet"
          description="Run AI evaluation first to see results here."
        />
      </div>
    );
  }

  // Check if evaluation is complete with API critique data
  const hasClassicKeys = aiEval.apiCritique?.transcriptComparison || aiEval.apiCritique?.structuredComparison;
  const hasRawOutput = !!aiEval.apiCritique?.rawOutput;
  if (!aiEval.apiCritique || (!hasClassicKeys && !hasRawOutput)) {
    return (
      <div className="flex-1 min-h-full flex items-center justify-center p-8">
        <EmptyState
          icon={AlertCircle}
          title="Evaluation data incomplete"
          description="Please re-run the AI evaluation."
        />
      </div>
    );
  }

  if (!aiEval.judgeOutput) {
    return (
      <div className="flex-1 min-h-full flex items-center justify-center p-8">
        <EmptyState
          icon={AlertCircle}
          title="Judge output not available"
          description="Please re-run the AI evaluation."
        />
      </div>
    );
  }

  // Extract normalization data for transcript toggle
  const normalizedApiTranscript = aiEval.normalizedOriginal?.fullTranscript;
  const normalizationMeta = aiEval.normalizationMeta ? {
    enabled: aiEval.normalizationMeta.enabled,
    sourceScript: aiEval.normalizationMeta.sourceScript,
    targetScript: aiEval.normalizationMeta.targetScript,
  } : undefined;

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
        <Card className="flex-1 min-h-[500px] p-0 overflow-hidden" hoverable={false}>
          <SemanticAuditView listing={listing} aiEval={aiEval} />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Overall Assessment */}
          <Card className="p-4" hoverable={false}>
            <h3 className="font-medium text-[var(--text-primary)] mb-2">Overall Assessment</h3>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {aiEval.apiCritique.overallAssessment || 'No assessment available.'}
            </p>
          </Card>

          {/* Transcript Comparison - Collapsible */}
          {aiEval.apiCritique.transcriptComparison && (
            <ApiTranscriptComparison
              apiTranscript={apiResponse.input}
              judgeTranscript={aiEval.judgeOutput.transcript}
              critique={aiEval.apiCritique.transcriptComparison}
              normalizedApiTranscript={normalizedApiTranscript}
              normalizationMeta={normalizationMeta}
            />
          )}

          {/* Structured Output Comparison - Collapsible */}
          {aiEval.apiCritique.structuredComparison && (
            <ApiStructuredComparison comparison={aiEval.apiCritique.structuredComparison} />
          )}

          {/* Raw LLM output when classic keys aren't present */}
          {!hasClassicKeys && hasRawOutput && (
            <Card className="p-4" hoverable={false}>
              <h3 className="font-medium text-[var(--text-primary)] mb-2">Evaluation Output</h3>
              <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap overflow-auto max-h-[500px]">
                {JSON.stringify(aiEval.apiCritique.rawOutput, null, 2)}
              </pre>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
