import { useState, useCallback, useEffect } from 'react';
import { Tabs, Button } from '@/components/ui';
import { RefreshCw } from 'lucide-react';
import { AIEvalRequest } from './AIEvalRequest';
import { AIEvalStatus } from './AIEvalStatus';
import { SegmentComparisonTable } from './SegmentComparisonTable';
import { ApiEvalsView } from './ApiEvalsView';
import { HumanEvalNotepad } from './HumanEvalNotepad';
import { EvaluationModal } from './EvaluationModal';
import { useAIEvaluation, type EvaluationConfig } from '../hooks/useAIEvaluation';
import { filesRepository } from '@/services/storage';
import { useTaskQueueStore } from '@/stores';
import type { Listing } from '@/types';

interface EvalsViewProps {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
  /** Hide the Re-run button (when it's moved to the page header) */
  hideRerunButton?: boolean;
}

export function EvalsView({ listing, onUpdate, hideRerunButton = false }: EvalsViewProps) {
  const { evaluate, cancel } = useAIEvaluation();
  const { tasks } = useTaskQueueStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasAudioBlob, setHasAudioBlob] = useState(false);

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
      onUpdate({
        ...listing,
        aiEval: result,
      });
    }
  }, [evaluate, listing, onUpdate]);

  const handleRequestEval = useCallback(() => {
    handleOpenModal();
  }, [handleOpenModal]);

  // Detect API flow
  const isApiFlow = listing.sourceType === 'api';

  const hasAIEval = !!listing.aiEval;
  const hasComparison = hasAIEval && listing.aiEval?.status === 'completed' && (
    isApiFlow 
      ? listing.aiEval?.apiCritique && listing.aiEval?.judgeOutput
      : listing.aiEval?.llmTranscript
  );

  const aiEvalContent = (
    <div className="space-y-4">
      {/* AI Eval Request or Status */}
      {!hasAIEval ? (
        <AIEvalRequest
          onRequestEval={handleRequestEval}
          isEvaluating={isEvaluating}
          hasAudio={!!listing.audioFile}
          hasTranscript={!!listing.transcript}
          onCancel={cancel}
        />
      ) : (
        <>
          {/* Compact status strip + Re-run button in same row (unless hidden) */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <AIEvalStatus evaluation={listing.aiEval!} />
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
          <ApiEvalsView listing={listing} />
        ) : (
          listing.transcript && listing.aiEval?.llmTranscript && (
            <SegmentComparisonTable
              original={listing.transcript}
              llmGenerated={listing.aiEval.llmTranscript}
              critique={listing.aiEval.critique}
              audioFileId={listing.audioFile?.id}
              normalizedOriginal={listing.aiEval.normalizedOriginal}
              normalizationMeta={listing.aiEval.normalizationMeta}
            />
          )
        )
      )}

      {/* Evaluation Modal - only needed if Re-run is shown here */}
      {!hideRerunButton && (
        <EvaluationModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          listing={listing}
          onStartEvaluation={handleStartEvaluation}
          hasAudioBlob={hasAudioBlob}
        />
      )}
    </div>
  );

  const humanEvalContent = (
    <HumanEvalNotepad listing={listing} />
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
