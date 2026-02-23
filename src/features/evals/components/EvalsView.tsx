import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, Button } from '@/components/ui';
import { RefreshCw, Loader2, ExternalLink, Send, Undo2 } from 'lucide-react';
import { routes } from '@/config/routes';
import { AIEvalRequest } from './AIEvalRequest';
import { AIEvalStatus } from './AIEvalStatus';
import { HumanReviewStatus } from './HumanReviewStatus';
import { SegmentComparisonTable } from './SegmentComparisonTable';
import { ApiEvalsView } from './ApiEvalsView';
import { MetricsBar } from './MetricsBar';
import { EvaluationOverlay } from './EvaluationOverlay';
import { useAIEvaluation, type EvaluationConfig } from '../hooks/useAIEvaluation';
import { useHumanReview } from '../hooks/useHumanReview';
import { useListingMetrics } from '../hooks/useListingMetrics';
import { filesRepository } from '@/services/storage';
import { fetchLatestRun } from '@/services/api/evalRunsApi';
import { useTaskQueueStore, useJobTrackerStore } from '@/stores';
import type { Listing, AIEvaluation, TranscriptData, OverallVerdict } from '@/types';

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
}

const VERDICT_LABEL: Record<OverallVerdict, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  accepted_with_corrections: 'Accepted with Corrections',
};

const VERDICT_COLORS: Record<OverallVerdict, string> = {
  accepted: 'text-[var(--color-success)]',
  rejected: 'text-[var(--color-error)]',
  accepted_with_corrections: 'text-[var(--color-warning)]',
};

export function EvalsView({ listing, onUpdate, hideRerunButton = false, aiEval: externalAiEval, onAiEvalChange, aiEvalRunId: externalRunId }: EvalsViewProps) {
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

  // Metrics source toggle state
  const [metricsSource, setMetricsSource] = useState<'ai' | 'human'>('ai');

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

  // Metrics computation (supports AI and human-adjusted)
  const metrics = useListingMetrics(listing, aiEval, humanReview, metricsSource);

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
    if (metrics) {
      for (const m of metrics) {
        adjustedMetrics[m.id] = m.value;
      }
    }
    await submit('', adjustedMetrics);
  }, [submit, metrics]);

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

  // --- Human Review tab content ---
  const humanReviewContent = (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Status strip */}
      <HumanReviewStatus
        humanReview={humanReview}
        isDirty={isDirty}
        reviewedCount={reviewedCount}
        totalItems={totalItems}
        overallVerdict={overallVerdict}
      />

      {/* Metrics with toggle */}
      <MetricsBar
        metrics={metrics}
        hasHumanReview={!!humanReview}
        metricsSource={metricsSource}
        onMetricsSourceChange={setMetricsSource}
      />

      {/* Same comparison table, review mode on */}
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

      {/* Submit footer */}
      {hasComparison && (
        <div className="sticky bottom-0 flex items-center gap-4 px-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-default)] shadow-sm">
          {/* Progress */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[var(--text-muted)]">
              {reviewedCount}/{totalItems} reviewed
            </span>
            <div className="w-24 h-1.5 rounded-full bg-[var(--bg-tertiary)]">
              <div
                className="h-full rounded-full bg-[var(--color-brand-primary)] transition-all"
                style={{ width: `${totalItems > 0 ? (reviewedCount / totalItems) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Verdict badge */}
          {overallVerdict && (
            <span className={`text-[12px] font-medium ${VERDICT_COLORS[overallVerdict]}`}>
              {VERDICT_LABEL[overallVerdict]}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Discard button */}
          {isDirty && (
            <Button
              variant="ghost"
              size="sm"
              onClick={discard}
              className="h-8 gap-1.5"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Discard
            </Button>
          )}

          {/* Submit button */}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isSubmitting || (!isDirty && !!humanReview)}
            className="h-8 gap-1.5"
          >
            {isSubmitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {humanReview ? 'Update Review' : 'Submit Review'}
          </Button>
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
      label: 'Human Review',
      content: humanReviewContent,
    },
  ];

  return (
    <Tabs tabs={tabs} fillHeight />
  );
}
