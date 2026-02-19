import { useState, useMemo } from 'react';
import { LayoutList, Columns3, FlaskConical, AlertCircle } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';
import { ApiTranscriptComparison } from './ApiTranscriptComparison';
import { ApiStructuredComparison } from './ApiStructuredComparison';
import { SemanticAuditView } from './SemanticAuditView';
import { extractFieldCritiques, buildStructuredComparison } from '../utils/extractFieldCritiques';
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

  // Build structuredComparison for Classic view from rawOutput.field_critiques
  // when the classic shape (structuredComparison.fields) isn't present
  const classicStructuredComparison = useMemo(() => {
    if (aiEval.apiCritique?.structuredComparison) {
      return aiEval.apiCritique.structuredComparison;
    }
    const critiques = extractFieldCritiques(aiEval.apiCritique);
    if (critiques.length > 0) {
      return buildStructuredComparison(
        critiques,
        aiEval.apiCritique?.overallAssessment || '',
      );
    }
    return undefined;
  }, [aiEval.apiCritique]);

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
        <Card className="max-h-[calc(100vh-320px)] min-h-[400px] p-0 overflow-hidden" hoverable={false}>
          <SemanticAuditView listing={listing} aiEval={aiEval} />
        </Card>
      ) : (
        <div className="space-y-4">
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

          {/* Structured Output Comparison — works for both classic and semantic audit shapes */}
          {classicStructuredComparison && (
            <ApiStructuredComparison comparison={classicStructuredComparison} />
          )}
        </div>
      )}
    </div>
  );
}
