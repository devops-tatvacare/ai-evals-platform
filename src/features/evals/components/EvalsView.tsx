import { useState, useCallback, useEffect } from 'react';
import { Tabs, Button } from '@/components/ui';
import { RefreshCw } from 'lucide-react';
import { AIEvalRequest } from './AIEvalRequest';
import { AIEvalStatus } from './AIEvalStatus';
import { SegmentComparisonTable } from './SegmentComparisonTable';
import { ApiEvalsView } from './ApiEvalsView';
import { HumanEvalNotepad } from './HumanEvalNotepad';
import { EvaluationOverlay } from './EvaluationOverlay';
import { useAIEvaluation, type EvaluationConfig } from '../hooks/useAIEvaluation';
import { filesRepository } from '@/services/storage';
import { fetchLatestRun } from '@/services/api/evalRunsApi';
import { useTaskQueueStore } from '@/stores';
import type { Listing, AIEvaluation } from '@/types';

interface EvalsViewProps {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
  /** Hide the Re-run button (when it's moved to the page header) */
  hideRerunButton?: boolean;
  /** Pre-fetched AI evaluation (from parent); if provided, skips internal fetch */
  aiEval?: AIEvaluation | null;
  /** Callback to notify parent when aiEval changes */
  onAiEvalChange?: (aiEval: AIEvaluation | null) => void;
}

export function EvalsView({ listing, onUpdate, hideRerunButton = false, aiEval: externalAiEval, onAiEvalChange }: EvalsViewProps) {
  const { evaluate, cancel } = useAIEvaluation();
  const { tasks } = useTaskQueueStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasAudioBlob, setHasAudioBlob] = useState(false);
  const [internalAiEval, setInternalAiEval] = useState<AIEvaluation | null>(null);

  // Use external aiEval if provided, otherwise use internal state
  const aiEval = externalAiEval !== undefined ? externalAiEval : internalAiEval;

  // Fetch latest full evaluation from eval_runs API (only if not provided externally)
  useEffect(() => {
    if (externalAiEval !== undefined) return; // Parent provides it
    let cancelled = false;
    async function loadAiEval() {
      try {
        const latestRun = await fetchLatestRun({
          listing_id: listing.id,
          eval_type: 'full_evaluation',
        });
        if (!cancelled) {
          const eval_ = (latestRun?.result as AIEvaluation | undefined) ?? null;
          setInternalAiEval(eval_);
        }
      } catch {
        // Silently fail — eval data is optional
      }
    }
    loadAiEval();
    return () => { cancelled = true; };
  }, [listing.id, externalAiEval]);

  // Check if there's an active evaluation task for this listing
  const activeTask = tasks.find(
    (task) => 
      task.listingId === listing.id && 
      task.type === 'ai_eval' && 
      (task.status === 'pending' || task.status === 'processing')
  );
  const isEvaluating = !!activeTask;

  // Check if audio blob is available
  useEffect(() => {
    async function checkAudio() {
      if (listing.audioFile?.id) {
        const file = await filesRepository.getById(listing.audioFile.id);
        setHasAudioBlob(!!file);
      } else {
        setHasAudioBlob(false);
      }
    }
    checkAudio();
  }, [listing.audioFile?.id]);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleStartEvaluation = useCallback(async (config: EvaluationConfig) => {
    // Close modal immediately - evaluation runs in background
    setIsModalOpen(false);

    const result = await evaluate(listing, config);
    if (result) {
      // Update local aiEval state with the new result
      if (externalAiEval !== undefined) {
        onAiEvalChange?.(result);
      } else {
        setInternalAiEval(result);
      }
      onUpdate(listing);
    }
  }, [evaluate, listing, onUpdate, externalAiEval, onAiEvalChange]);

  const handleRequestEval = useCallback(() => {
    handleOpenModal();
  }, [handleOpenModal]);

  // Detect API flow
  const isApiFlow = listing.sourceType === 'api';

  const hasAIEval = !!aiEval;
  const hasComparison = hasAIEval && aiEval?.status === 'completed' && (
    isApiFlow
      ? aiEval?.apiCritique && aiEval?.judgeOutput
      : aiEval?.llmTranscript
  );

  const aiEvalContent = (
    <div className="space-y-4 min-h-full flex flex-col">
      {/* AI Eval Request or Status */}
      {!hasAIEval ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <AIEvalRequest
            onRequestEval={handleRequestEval}
            isEvaluating={isEvaluating}
            hasAudio={!!listing.audioFile}
            hasTranscript={!!listing.transcript}
            onCancel={cancel}
          />
        </div>
      ) : (
        <>
          {/* Compact status strip + Re-run button in same row (unless hidden) */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <AIEvalStatus evaluation={aiEval!} />
            </div>
            {!hideRerunButton && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleOpenModal}
                disabled={isEvaluating}
                className="h-8 gap-1.5 shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isEvaluating ? 'animate-spin' : ''}`} />
                Re-run
              </Button>
            )}
          </div>
        </>
      )}

      {/* Comparison View - switch based on flow type */}
      {hasComparison && (
        isApiFlow ? (
          <ApiEvalsView listing={listing} aiEval={aiEval} />
        ) : (
          listing.transcript && aiEval?.llmTranscript && (
            <SegmentComparisonTable
              original={listing.transcript}
              llmGenerated={aiEval.llmTranscript}
              critique={aiEval.critique}
              audioFileId={listing.audioFile?.id}
              normalizedOriginal={aiEval.normalizedOriginal}
              normalizationMeta={aiEval.normalizationMeta}
            />
          )
        )
      )}

      {/* Evaluation Modal - only needed if Re-run is shown here */}
      {!hideRerunButton && (
        <EvaluationOverlay
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          listing={listing}
          onStartEvaluation={handleStartEvaluation}
          hasAudioBlob={hasAudioBlob}
          aiEval={aiEval}
        />
      )}
    </div>
  );

  const humanEvalContent = (
    <HumanEvalNotepad listing={listing} aiEval={aiEval} />
  );

  // If no AI eval yet, show request view
  if (!hasAIEval) {
    return aiEvalContent;
  }

  // If AI eval exists, show tabbed view
  const tabs = [
    {
      id: 'ai-eval',
      label: 'AI Evaluation',
      content: aiEvalContent,
    },
    {
      id: 'human-eval',
      label: 'Human Review',
      content: humanEvalContent,
    },
  ];

  return (
    <div>
      <Tabs tabs={tabs} />
    </div>
  );
}
