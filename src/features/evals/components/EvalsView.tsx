import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { routes } from '@/config/routes';
import { AIEvalRequest } from './AIEvalRequest';
import { AIEvalStatus } from './AIEvalStatus';
import { SegmentComparisonTable } from './SegmentComparisonTable';
import { ApiEvalsView } from './ApiEvalsView';
import { EvaluationOverlay } from './EvaluationOverlay';
import { useAIEvaluation, type EvaluationConfig } from '../hooks/useAIEvaluation';
import { filesRepository } from '@/services/storage';
import { fetchLatestRun } from '@/services/api/evalRunsApi';
import { useTaskQueueStore, useJobTrackerStore } from '@/stores';
import type { Listing, AIEvaluation, TranscriptData } from '@/types';

interface EvalsViewProps {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
  hideRerunButton?: boolean;
  aiEval?: AIEvaluation | null;
  onAiEvalChange?: (aiEval: AIEvaluation | null) => void;
  aiEvalRunId?: string | null;
}

export function EvalsView({
  listing,
  onUpdate,
  hideRerunButton = false,
  aiEval: externalAiEval,
  onAiEvalChange,
  aiEvalRunId: externalRunId,
}: EvalsViewProps) {
  const { evaluate, cancel } = useAIEvaluation();
  const { tasks } = useTaskQueueStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasAudioBlob, setHasAudioBlob] = useState(false);
  const [internalAiEval, setInternalAiEval] = useState<AIEvaluation | null>(null);
  const [internalRunId, setInternalRunId] = useState<string | null>(null);

  const aiEval = externalAiEval !== undefined ? externalAiEval : internalAiEval;
  const aiEvalRunId = externalRunId !== undefined ? externalRunId : internalRunId;
  const flowType = aiEval?.flowType ?? (listing.sourceType === 'api' ? 'api' : 'upload');

  useEffect(() => {
    if (externalAiEval !== undefined) return;
    let cancelled = false;
    async function loadAiEval() {
      try {
        const latestRun = await fetchLatestRun({
          listing_id: listing.id,
          eval_type: 'full_evaluation',
        });
        if (!cancelled) {
          setInternalAiEval((latestRun?.result as AIEvaluation | undefined) ?? null);
          setInternalRunId(latestRun?.id ?? null);
        }
      } catch {
        // Optional surface.
      }
    }
    loadAiEval();
    return () => {
      cancelled = true;
    };
  }, [externalAiEval, listing.id]);

  const activeTask = tasks.find(
    (task) =>
      task.listingId === listing.id &&
      task.type === 'ai_eval' &&
      (task.status === 'pending' || task.status === 'processing'),
  );
  const trackedJobs = useJobTrackerStore((state) => state.activeJobs);
  const trackedJob = trackedJobs.find(
    (job) => job.listingId === listing.id && job.jobType === 'evaluate-voice-rx',
  );
  const isEvaluating = !!activeTask || !!trackedJob;
  const activeRunId = activeTask?.runId ?? trackedJob?.runId;

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
    setIsModalOpen(false);

    if (externalAiEval !== undefined) {
      onAiEvalChange?.(null);
    } else {
      setInternalAiEval(null);
      setInternalRunId(null);
    }

    const result = await evaluate(listing, config);
    if (result) {
      if (externalAiEval !== undefined) {
        onAiEvalChange?.(result);
      } else {
        setInternalAiEval(result);
      }
      onUpdate(listing);
    }
  }, [evaluate, externalAiEval, listing, onAiEvalChange, onUpdate]);

  const hasAIEval = !!aiEval;
  const hasComparison = hasAIEval && aiEval?.status === 'completed' && (
    flowType === 'api'
      ? !!aiEval?.critique && !!aiEval?.judgeOutput
      : !!aiEval?.judgeOutput
  );

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {!hasAIEval ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <AIEvalRequest
            onRequestEval={handleOpenModal}
            isEvaluating={isEvaluating}
            hasAudio={!!listing.audioFile}
            hasTranscript={!!listing.transcript}
            onCancel={cancel}
            activeRunId={activeRunId}
          />
        </div>
      ) : (
        <>
          {isEvaluating && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-info)]/20 bg-[var(--surface-info)] px-4 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)] shrink-0" />
              <span className="text-[13px] text-[var(--text-secondary)]">Re-running evaluation...</span>
              {activeRunId && (
                <Link
                  to={routes.voiceRx.runDetail(activeRunId)}
                  className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-brand)] hover:underline"
                >
                  View Run
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <AIEvalStatus evaluation={aiEval} />
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

          {aiEvalRunId && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">
              Human review moved to the shared run detail page.
              <Link
                to={routes.voiceRx.runDetail(aiEvalRunId)}
                className="ml-2 inline-flex items-center gap-1 font-medium text-[var(--text-brand)] hover:underline"
              >
                Open Reviews
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </>
      )}

      {hasComparison && (
        flowType === 'api' ? (
          <ApiEvalsView listing={listing} aiEval={aiEval} />
        ) : (
          listing.transcript && aiEval?.judgeOutput && (
            <div>
              <SegmentComparisonTable
                original={listing.transcript}
                llmGenerated={{
                  fullTranscript: aiEval.judgeOutput.transcript,
                  segments: aiEval.judgeOutput.segments ?? [],
                } as unknown as TranscriptData}
                critique={aiEval.critique}
                audioFileId={listing.audioFile?.id}
                normalizedOriginal={aiEval.normalizedOriginal ? {
                  fullTranscript: aiEval.normalizedOriginal.fullTranscript,
                  segments: aiEval.normalizedOriginal.segments ?? [],
                } as unknown as TranscriptData : undefined}
                normalizationMeta={aiEval.normalizationMeta}
              />
            </div>
          )
        )
      )}

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
}
