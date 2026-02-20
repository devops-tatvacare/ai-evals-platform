import { useState, useMemo } from 'react';
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

  // Build structuredComparison for Classic view from unified critique
  // Must be called before any early returns to respect Rules of Hooks
  const classicStructuredComparison = useMemo(() => {
    const fcs = aiEval?.critique?.fieldCritiques;
    if (!fcs || fcs.length === 0) return undefined;
    const matches = fcs.filter(c => c.match).length;
    return {
      fields: fcs,
      overallAccuracy: Math.round((matches / fcs.length) * 100),
      summary: aiEval?.critique?.overallAssessment || '',
    };
  }, [aiEval?.critique]);

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

  // Check if evaluation is complete with critique data
  if (!aiEval.critique) {
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
    <div className="flex flex-col h-full min-h-0">
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
        <Card className="flex-1 min-h-0 p-0 overflow-hidden flex flex-col" hoverable={false}>
          <SemanticAuditView listing={listing} aiEval={aiEval} />
        </Card>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto space-y-4">
          {/* Transcript Comparison - Collapsible */}
          {aiEval.critique.transcriptComparison && (
            <ApiTranscriptComparison
              apiTranscript={apiResponse.input}
              judgeTranscript={aiEval.judgeOutput.transcript}
              critique={aiEval.critique.transcriptComparison as { overallMatch: number; critique: string }}
              normalizedApiTranscript={normalizedApiTranscript}
              normalizationMeta={normalizationMeta}
            />
          )}

          {/* Structured Output Comparison */}
          {classicStructuredComparison && (
            <ApiStructuredComparison comparison={classicStructuredComparison} />
          )}
        </div>
      )}
    </div>
  );
}
