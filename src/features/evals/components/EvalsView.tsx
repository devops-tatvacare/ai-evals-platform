import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, Button } from '@/components/ui';
import { RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import { routes } from '@/config/routes';
import { AIEvalRequest } from './AIEvalRequest';
import { AIEvalStatus } from './AIEvalStatus';
import { HumanReviewStatus } from './HumanReviewStatus';
import { SegmentComparisonTable } from './SegmentComparisonTable';
import { ApiEvalsView } from './ApiEvalsView';
import { EvaluationOverlay } from './EvaluationOverlay';
import { useAIEvaluation, type EvaluationConfig } from '../hooks/useAIEvaluation';
import { useHumanReview } from '../hooks/useHumanReview';
import { useListingMetrics } from '../hooks/useListingMetrics';
import { filesRepository } from '@/services/storage';
import { fetchLatestRun } from '@/services/api/evalRunsApi';
import { useTaskQueueStore, useJobTrackerStore } from '@/stores';
import type { Listing, AIEvaluation, TranscriptData } from '@/types';

interface EvalsViewProps {
  listing: Listing;
  onUpdate: (listing: Listing) => void;
  /** Hide the Re-run button (when it's moved to the page header) */
  hideRerunButton?: boolean;
  /** Pre-fetched AI evaluation (from parent); if provided, skips internal fetch */
  aiEval?: AIEvaluation | null;
  /** Callback to notify parent when aiEval changes */
  onAiEvalChange?: (aiEval: AIEvaluation | null) => void;
  /** Eval run row ID (needed for human review linking) */
  aiEvalRunId?: string | null;
  /** Callback to notify parent when human review is saved/updated */
  onHumanReviewChange?: (review: import('@/types').HumanReview) => void;
}

export function EvalsView({ listing, onUpdate, hideRerunButton = false, aiEval: externalAiEval, onAiEvalChange, aiEvalRunId: externalRunId, onHumanReviewChange }: EvalsViewProps) {
  const { evaluate, cancel } = useAIEvaluation();
  const { tasks } = useTaskQueueStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasAudioBlob, setHasAudioBlob] = useState(false);
  const [internalAiEval, setInternalAiEval] = useState<AIEvaluation | null>(null);
  const [internalRunId, setInternalRunId] = useState<string | null>(null);

  // Use external aiEval if provided, otherwise use internal state
  const aiEval = externalAiEval !== undefined ? externalAiEval : internalAiEval;
  const aiEvalRunId = externalRunId !== undefined ? externalRunId : internalRunId;

  // Detect flow type from aiEval or listing
  const flowType = aiEval?.flowType ?? (listing.sourceType === 'api' ? 'api' : 'upload');

  // Total items for review (segments or fields)
  const totalItems = useMemo(() => {
    if (flowType === 'api') {
      return aiEval?.critique?.fieldCritiques?.length ?? 0;
    }
    return Math.max(
      listing.transcript?.segments.length ?? 0,
      aiEval?.judgeOutput?.segments?.length ?? 0,
    );
  }, [flowType, listing.transcript, aiEval]);

  // Human review hook — manages local state + backend persistence
  const {
    humanReview,
    isDirty,
    isSubmitting,
    segmentReviews,
    fieldReviews,
    setSegmentReview,
    setFieldReview,
    overallVerdict,
    reviewedCount,
    submit,
    discard,
  } = useHumanReview({
    aiEvalRunId: aiEvalRunId ?? undefined,
    flowType,
    totalItems,
  });

  // Compute human-adjusted metrics from LIVE working state (not saved review).
  // This ensures submit payload contains metrics reflecting current edits.
  const workingReviewState = useMemo(() => ({
    segmentReviews,
    fieldReviews,
  }), [segmentReviews, fieldReviews]);

  const humanAdjustedMetrics = useListingMetrics(listing, aiEval, humanReview, 'human', workingReviewState);

  // Fetch latest full evaluation from eval_runs API (only if not provided externally)
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
          const eval_ = (latestRun?.result as AIEvaluation | undefined) ?? null;
          setInternalAiEval(eval_);
          setInternalRunId(latestRun?.id ?? null);
        }
      } catch {
        // Silently fail — eval data is optional
      }
    }
    loadAiEval();
    return () => { cancelled = true; };
  }, [listing.id, externalAiEval]);

  // Check if there's an active evaluation
  const activeTask = tasks.find(
    (task) =>
      task.listingId === listing.id &&
      task.type === 'ai_eval' &&
      (task.status === 'pending' || task.status === 'processing')
  );
  const trackedJobs = useJobTrackerStore((state) => state.activeJobs);
  const trackedJob = trackedJobs.find(
    (job) => job.listingId === listing.id && job.jobType === 'evaluate-voice-rx',
  );
  const isEvaluating = !!activeTask || !!trackedJob;
  const activeRunId = activeTask?.runId ?? trackedJob?.runId;

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
    setIsModalOpen(false);

    // Clear old eval immediately so UI transitions to the progress screen
    // instead of showing a thin strip on top of stale results
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
  }, [evaluate, listing, onUpdate, externalAiEval, onAiEvalChange]);

  const handleRequestEval = useCallback(() => {
    handleOpenModal();
  }, [handleOpenModal]);

  // Submit human review with adjusted metrics
  const handleSubmit = useCallback(async () => {
    // Build adjusted metrics from current review state
    const adjustedMetrics: Record<string, number> = {};
    if (humanAdjustedMetrics) {
      for (const m of humanAdjustedMetrics) {
        adjustedMetrics[m.id] = m.value;
      }
    }
    const savedReview = await submit('', adjustedMetrics);
    if (savedReview) {
      // Propagate to parent so header metrics refresh immediately
      onHumanReviewChange?.(savedReview);
      // Backend marks listing as completed; reflect in UI
      if (listing.status !== 'completed') {
        onUpdate({ ...listing, status: 'completed' });
      }
    }
  }, [submit, humanAdjustedMetrics, listing, onUpdate, onHumanReviewChange]);

  const hasAIEval = !!aiEval;
  const hasComparison = hasAIEval && aiEval?.status === 'completed' && (
    flowType === 'api'
      ? !!aiEval?.critique && !!aiEval?.judgeOutput
      : !!aiEval?.judgeOutput
  );

  // --- AI Evaluation tab content ---
  const aiEvalContent = (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {!hasAIEval ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <AIEvalRequest
            onRequestEval={handleRequestEval}
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
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--surface-info)] border border-[var(--color-info)]/20">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)] shrink-0" />
              <span className="text-[13px] text-[var(--text-secondary)]">Re-running evaluation...</span>
              {activeRunId && (
                <Link
                  to={routes.voiceRx.runDetail(activeRunId)}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-brand)] hover:underline ml-auto"
                >
                  View Run
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}
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

  // --- Human Evaluation tab content ---
  const humanReviewContent = (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Unified action bar: progress + verdict + discard/submit */}
      <HumanReviewStatus
        humanReview={humanReview}
        isDirty={isDirty}
        isSubmitting={isSubmitting}
        reviewedCount={reviewedCount}
        totalItems={totalItems}
        overallVerdict={overallVerdict}
        onSubmit={handleSubmit}
        onDiscard={discard}
      />

      {/* Comparison table in review mode */}
      {hasComparison && (
        flowType === 'api' ? (
          <ApiEvalsView
            listing={listing}
            aiEval={aiEval}
            reviewMode={true}
            fieldReviews={fieldReviews}
            onFieldReviewChange={setFieldReview}
          />
        ) : (
          listing.transcript && aiEval?.judgeOutput && (
            <div className="flex-1 min-h-0">
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
                reviewMode={true}
                segmentReviews={segmentReviews}
                onSegmentReviewChange={setSegmentReview}
              />
            </div>
          )
        )
      )}

      {!hasComparison && (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <p className="text-[13px] text-[var(--text-muted)]">
            Complete an AI evaluation first to begin human review.
          </p>
        </div>
      )}
    </div>
  );

  // If no AI eval yet, show request view (no tabs)
  if (!hasAIEval) {
    return aiEvalContent;
  }

  // Show tabbed view
  const tabs = [
    {
      id: 'ai-eval',
      label: 'AI Evaluation',
      content: aiEvalContent,
    },
    {
      id: 'human-eval',
      label: 'Human Evaluation',
      content: humanReviewContent,
    },
  ];

  return (
    <Tabs tabs={tabs} fillHeight />
  );
}
