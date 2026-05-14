/* eslint-disable react-refresh/only-export-components --
 * Run-detail registry entry: this file exports a `RunDetailAppEntry` (the
 * registry contract) alongside the helper components its body renders.
 * Fast-refresh degrades to a full reload for this file — accepted tradeoff. */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePoll } from '@/hooks';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Calendar, Cpu, ChevronRight, Info, ListChecks } from 'lucide-react';
import { ConfirmDialog, Tooltip } from '@/components/ui';
import { EvalRunVisibilityPanel, VerdictBadge, OutputFieldRenderer, RunProgressBar } from '@/features/evalRuns/components';
import { RunHeaderActions } from '@/features/evalRuns/components/RunHeaderActions';
import { useElapsedTime } from '@/features/evalRuns/hooks';
import { AppReportTab } from '@/features/analytics/AppReportTab';
import {
  useInlineReviewOptional,
  InlineReviewBadge, InlineReviewControls, VerdictChip,
  useReviewOverrides, StartReviewButton,
} from '@/features/reviews/inline';
import DistributionBar from '@/features/evalRuns/components/DistributionBar';
import { fetchEvalRun, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi, type Job } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { routes } from '@/config/routes';
import { formatTimestamp, formatDuration, pct } from '@/utils/evalFormatters';
import type { EvalRun, OutputFieldDef, AIEvaluation, FieldCritique, ReviewableItem, ReviewableAttribute } from '@/types';
import { isTerminalRunStatus } from '@/types';
import { RunDetailTabStrip } from './RunDetailTabStrip';
import type { RunDetailAppEntry, RunDetailView } from './types';

/* ── Page ────────────────────────────────────────────────── */

function useVoiceRxRunDetail(runId: string): RunDetailView {
  const navigate = useNavigate();
  const [run, setRun] = useState<EvalRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Initial fetch
  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    fetchEvalRun(runId)
      .then(setRun)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  // Poll while run is in-progress
  const isActive = !!runId && !!run && !isTerminalRunStatus(run.status);
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.startedAt ?? null, isActive);

  usePoll({
    fn: async () => {
      const updated = await fetchEvalRun(runId!);
      setRun(updated);
      return !isTerminalRunStatus(updated.status);
    },
    enabled: isActive,
  });

  // Job progress poll (only when run has a jobId)
  const runJobId = run?.jobId ?? null;
  usePoll({
    fn: async () => {
      if (!runJobId) return false;
      const job = await jobsApi.get(runJobId);
      setActiveJob(job);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        return false;
      }
      return true;
    },
    enabled: isActive && !!runJobId,
  });

  const handleCancel = useCallback(async () => {
    if (!activeJob) return;
    setCancelling(true);
    try {
      await jobsApi.cancel(activeJob.id);
      setActiveJob((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
      setRun((prev) => prev ? { ...prev, status: 'cancelled' as EvalRun['status'] } : prev);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }, [activeJob]);

  const handleDelete = useCallback(async () => {
    if (!run) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(run.id);
      notificationService.success('Run deleted');
      navigate(routes.voiceRx.runs);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }, [run, navigate]);

  if (loading) {
    return { phase: 'loading' };
  }

  if (error || !run) {
    return { phase: 'error', message: error || 'Run not found' };
  }

  const config = run.config as Record<string, unknown> | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const evalName =
    (summary?.evaluator_name as string) ??
    (config?.evaluator_name as string) ??
    run.evalType ??
    'Evaluation';

  const metaTooltip = (
    <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-muted)]">ID</span>
        <span className="font-mono text-[var(--text-primary)]">{run.id.slice(0, 12)}</span>
      </div>
      {run.createdAt && (
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 text-[var(--text-muted)]" />
          <span>{formatTimestamp(run.createdAt)}</span>
        </div>
      )}
      {run.durationMs != null && (
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-[var(--text-muted)]" />
          <span>{formatDuration(run.durationMs / 1000)}</span>
        </div>
      )}
      {run.llmModel && (
        <div className="flex items-center gap-2">
          <Cpu className="h-3 w-3 text-[var(--text-muted)]" />
          <span>{run.llmProvider}/{run.llmModel}</span>
        </div>
      )}
    </div>
  );

  const subtitle = (
    <>
      <VerdictBadge verdict={run.status} category="status" />
      <Tooltip content={metaTooltip} closeDelay={150}>
        <Info className="h-3.5 w-3.5 text-[var(--text-muted)] cursor-help" />
      </Tooltip>
    </>
  );

  const actions = (
    <RunHeaderActions
      logsHref={`${routes.voiceRx.logs}?run_id=${run.id}`}
      isActive={isActive}
      cancelling={cancelling}
      deleting={false}
      onCancel={handleCancel}
      onDelete={() => setDeleteOpen(true)}
      visibilityContent={(
        <EvalRunVisibilityPanel
          runId={run.id}
          visibility={run.visibility ?? 'private'}
          ownerId={run.userId}
          mode="inline"
          onUpdated={(visibility) => setRun((current) => (current ? { ...current, visibility } : current))}
        />
      )}
      reviewContent={<StartReviewButton runId={run.id} />}
    />
  );

  const failureBanner = run.status === 'failed' ? (
    <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-2.5 text-sm">
      <div className="flex items-center gap-2 text-[var(--color-error)]">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <strong className="text-xs">
          {(run.result as Record<string, unknown>)?.failedStep
            ? `Failed during ${(run.result as Record<string, unknown>).failedStep}`
            : 'Evaluation failed'}
        </strong>
      </div>
      {run.errorMessage && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{run.errorMessage}</p>
      )}
    </div>
  ) : null;

  const tabs = [
    {
      id: 'results',
      label: 'Results',
      content: run.evalType === 'full_evaluation' ? (
        <FullEvaluationDetail run={run} />
      ) : run.evalType === 'custom' ? (
        <CustomEvalDetail run={run} />
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Unknown evaluation type: {run.evalType}
        </p>
      ),
    },
    ...(run.evalType === 'full_evaluation' && runId ? [{
      id: 'report',
      label: 'Report',
      content: (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AppReportTab appId="voice-rx" runId={runId} />
        </div>
      ),
    }] : []),
  ];

  return {
    phase: 'ready',
    reviewRunId: run.id,
    header: {
      icon: ListChecks,
      title: evalName,
      subtitle,
      actions,
    },
    body: (
      <>
        {failureBanner}
        {isActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}
        <RunDetailTabStrip tabs={tabs} />
      </>
    ),
    dialogs: (
      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Run"
        description="Delete this evaluator run? This cannot be undone."
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    ),
  };
}

export const voiceRxRunDetailEntry: RunDetailAppEntry = {
  useRunDetail: useVoiceRxRunDetail,
};

/* ── FullEvaluationDetail ────────────────────────────────── */

function FullEvaluationDetail({ run }: { run: EvalRun }) {
  const result = run.result as AIEvaluation | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const review = useInlineReviewOptional();

  // Compute human-adjusted severity counts from review overrides
  const adjusted = useMemo(() => {
    if (!result?.critique || !review) return null;

    const items: Array<{ aiSeverity: string; key: string }> = [];
    if (result.flowType === 'upload' && result.critique.segments) {
      result.critique.segments.forEach((seg, i) => {
        const segIdx = String((seg as Record<string, unknown>).segmentIndex ?? i);
        items.push({ aiSeverity: ((seg as Record<string, unknown>).severity as string) ?? 'NONE', key: segIdx });
      });
    } else if (result.flowType === 'api' && result.critique.fieldCritiques) {
      result.critique.fieldCritiques.forEach((fc) => {
        items.push({ aiSeverity: fc.severity ?? 'NONE', key: fc.fieldPath });
      });
    }

    if (items.length === 0) return null;

    let critical = 0;
    let moderate = 0;
    let noneCount = 0;
    const dist: Record<string, number> = {};

    for (const { aiSeverity, key } of items) {
      const itemKey = result.flowType === 'upload' ? `segment:${key}` : `field:${key}`;
      const edit = review.getEdit(itemKey, 'severity');
      const sev = (edit?.decision === 'correct' && edit.reviewedValue != null)
        ? edit.reviewedValue.toUpperCase()
        : aiSeverity.toUpperCase();
      if (sev === 'CRITICAL') critical++;
      if (sev === 'MODERATE') moderate++;
      if (sev === 'NONE') noneCount++;
      dist[sev] = (dist[sev] ?? 0) + 1;
    }

    const accuracy = items.length > 0 ? noneCount / items.length : 0;
    return { critical, moderate, accuracy, distribution: dist };
  }, [result, review]);

  if (!result?.critique) {
    return <p className="text-sm text-[var(--text-muted)] italic">No evaluation data.</p>;
  }

  const flowType = result.flowType;
  const warnings = (result as unknown as Record<string, unknown>)?.warnings as string[] | undefined;

  // AI values from summary
  const aiCritical = summary?.critical_errors as number | undefined;
  const aiModerate = summary?.moderate_errors as number | undefined;
  const aiAccuracy = summary?.overall_accuracy as number | undefined;
  const aiDistribution = summary?.severity_distribution as Record<string, number> | undefined;

  // Human-adjusted values (fall back to AI when no adjustments)
  const adjCritical = adjusted?.critical;
  const adjModerate = adjusted?.moderate;
  const adjAccuracy = adjusted?.accuracy;
  const adjDistribution = adjusted?.distribution;

  // Check if distributions actually differ
  const distChanged = adjDistribution && aiDistribution &&
    JSON.stringify(adjDistribution) !== JSON.stringify(aiDistribution);

  return (
    <div className="space-y-4">
      {/* Normalization warnings */}
      {warnings && warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2.5 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-1.5 font-semibold mb-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warnings
          </div>
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
      {/* Summary stats */}
      {summary != null && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {aiAccuracy != null && (
            <StatCard
              label="Overall Accuracy"
              value={pct(adjAccuracy ?? aiAccuracy)}
              beforeValue={adjAccuracy != null ? pct(aiAccuracy) : undefined}
            />
          )}
          {summary.total_items != null && (
            <StatCard
              label={summary.flow_type === 'api' ? 'Total Fields' : 'Total Segments'}
              value={summary.total_items as number}
            />
          )}
          {aiCritical != null && (
            <StatCard
              label="Critical Errors"
              value={adjCritical ?? aiCritical}
              beforeValue={adjCritical != null ? aiCritical : undefined}
              color={(adjCritical ?? aiCritical) > 0 ? 'var(--color-error)' : undefined}
            />
          )}
          {aiModerate != null && (
            <StatCard
              label="Moderate Errors"
              value={adjModerate ?? aiModerate}
              beforeValue={adjModerate != null ? aiModerate : undefined}
              color={(adjModerate ?? aiModerate) > 0 ? 'var(--color-warning)' : undefined}
            />
          )}
          <ReviewedStatPill
            totalItems={
              flowType === 'upload'
                ? (result.critique.segments?.length ?? 0)
                : (result.critique.fieldCritiques?.length ?? 0)
            }
          />
        </div>
      )}

      {/* Severity distribution bar */}
      {aiDistribution != null && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            Severity Distribution
          </h3>
          <DistributionBar
            distribution={distChanged ? adjDistribution! : aiDistribution}
            aiDistribution={distChanged ? aiDistribution : undefined}
            order={['NONE', 'MINOR', 'MODERATE', 'CRITICAL']}
          />
        </div>
      )}

      {/* Flow-specific detail — dispatched by explicit flowType */}
      {flowType === 'upload' && result.critique.segments ? (
        <SegmentTable segments={result.critique.segments} runId={run.id} />
      ) : flowType === 'api' && result.critique.fieldCritiques ? (
        <FieldCritiqueTable
          fieldCritiques={result.critique.fieldCritiques}
          overallAssessment={result.critique.overallAssessment}
          runId={run.id}
        />
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic">No detail data.</p>
      )}

      {/* Raw data (collapsible card) */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md">
        <details className="group">
          <summary className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Raw Prompts &amp; Responses
          </summary>
          <div className="px-4 pb-3 border-t border-[var(--border-subtle)]">
            <pre className="mt-3 text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-64 text-[var(--text-secondary)]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

/* ── SegmentTable (upload flow) ──────────────────────────── */

function SegmentTable({ segments, runId }: { segments: Array<Record<string, unknown>>; runId: string }) {
  const review = useInlineReviewOptional();
  const isEditing = review?.isEditing ?? false;
  const { getOverride } = useReviewOverrides(runId);

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
        Segment Comparison ({segments.length} segments)
      </h3>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead>
            <tr className="bg-[var(--bg-secondary)]">
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Original</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">AI Transcript</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-24">Severity</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Discrepancy</th>
              {review && <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-20">Review</th>}
              {isEditing && <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-20">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {segments.map((seg, i) => {
              const segIdx = String((seg.segmentIndex as number) ?? i);
              const itemKey = `segment:${segIdx}`;
              const edit = review?.getEdit(itemKey, 'severity');
              const aiSeverity = (seg.severity as string) ?? 'NONE';
              const override = getOverride(itemKey, 'severity');
              const item: ReviewableItem = {
                itemKey, itemType: 'segment', title: '', subtitle: null,
                badges: [], evidence: [], attributes: [],
              };
              const attr: ReviewableAttribute = {
                key: 'severity', label: 'Severity',
                originalValue: (seg.severity as string) ?? null,
                allowedValues: ['NONE', 'MINOR', 'MODERATE', 'CRITICAL'],
              };

              return (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)] align-top">
                    {(seg.segmentIndex as number) ?? i + 1}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-xs text-[var(--text-primary)]">
                      {seg.originalText as string || '\u2014'}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-xs text-[var(--text-primary)]">
                      {seg.judgeText as string || '\u2014'}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <VerdictChip
                      aiVerdict={aiSeverity}
                      humanVerdict={override?.reviewedValue}
                      category="correctness"
                      renderBadge={(v) => <SeverityBadge severity={v ?? 'NONE'} />}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[200px] align-top">
                    {seg.discrepancy as string || '\u2014'}
                  </td>
                  {review && (
                    <td className="px-3 py-2 align-top">
                      <InlineReviewBadge
                        decision={edit?.decision}
                        isDraft={review.selectedReview?.status === 'draft'}
                      />
                    </td>
                  )}
                  {isEditing && review && (
                    <td className="px-3 py-2 align-top">
                      <InlineReviewControls
                        decision={edit?.decision}
                        note={edit?.note}
                        originalValue={(seg.severity as string) ?? 'NONE'}
                        reviewedValue={edit?.reviewedValue}
                        allowedValues={attr.allowedValues}
                        onReject={() => review.acceptAttribute(item, attr)}
                        onClear={() => review.clearAttribute(item, attr)}
                        onOverride={(nextSeverity) => review.correctAttribute(item, attr, nextSeverity)}
                        onNote={(nextNote) => review.setAttributeNote(item, attr, nextNote)}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── FieldCritiqueTable (API flow) ───────────────────────── */

function FieldCritiqueTable({ fieldCritiques, overallAssessment, runId }: {
  fieldCritiques: FieldCritique[];
  overallAssessment: string;
  runId: string;
}) {
  const review = useInlineReviewOptional();
  const { getOverride } = useReviewOverrides(runId);
  const isEditing = review?.isEditing ?? false;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
        Field Comparison ({fieldCritiques.length} fields)
      </h3>
      {overallAssessment && (
        <p className="text-xs text-[var(--text-secondary)] mb-3">{overallAssessment}</p>
      )}
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead>
            <tr className="bg-[var(--bg-secondary)]">
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Field</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">API Value</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Judge Value</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-24">Severity</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)]">Critique</th>
              {review && <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-20">Review</th>}
              {isEditing && <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-muted)] w-20">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {fieldCritiques.map((fc, i) => {
              const itemKey = `field:${fc.fieldPath}`;
              const edit = review?.getEdit(itemKey, 'severity');
              const aiSeverity = fc.severity ?? 'NONE';
              const override = getOverride(itemKey, 'severity');
              const item: ReviewableItem = {
                itemKey, itemType: 'field', title: '', subtitle: null,
                badges: [], evidence: [], attributes: [],
              };
              const attr: ReviewableAttribute = {
                key: 'severity', label: 'Severity',
                originalValue: fc.severity ?? null,
                allowedValues: ['NONE', 'MINOR', 'MODERATE', 'CRITICAL'],
              };

              return (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2 text-xs font-mono text-[var(--text-primary)] align-top">
                    {fc.fieldPath}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-xs font-mono text-[var(--text-secondary)]">
                      {fc.apiValue == null ? '\u2014' : typeof fc.apiValue === 'object' ? JSON.stringify(fc.apiValue) : String(fc.apiValue)}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="text-xs font-mono text-[var(--text-secondary)]">
                      {fc.judgeValue == null ? '\u2014' : typeof fc.judgeValue === 'object' ? JSON.stringify(fc.judgeValue) : String(fc.judgeValue)}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <VerdictChip
                      aiVerdict={aiSeverity}
                      humanVerdict={override?.reviewedValue}
                      category="correctness"
                      renderBadge={(v) => <SeverityBadge severity={v ?? 'NONE'} />}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-[200px] align-top">
                    {fc.critique || '\u2014'}
                  </td>
                  {review && (
                    <td className="px-3 py-2 align-top">
                      <InlineReviewBadge
                        decision={edit?.decision}
                        isDraft={review.selectedReview?.status === 'draft'}
                      />
                    </td>
                  )}
                  {isEditing && review && (
                    <td className="px-3 py-2 align-top">
                      <InlineReviewControls
                        decision={edit?.decision}
                        note={edit?.note}
                        originalValue={fc.severity ?? 'NONE'}
                        reviewedValue={edit?.reviewedValue}
                        allowedValues={attr.allowedValues}
                        onReject={() => review.acceptAttribute(item, attr)}
                        onClear={() => review.clearAttribute(item, attr)}
                        onOverride={(nextSeverity) => review.correctAttribute(item, attr, nextSeverity)}
                        onNote={(nextNote) => review.setAttributeNote(item, attr, nextNote)}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── CustomEvalDetail ────────────────────────────────────── */

function CustomEvalDetail({ run }: { run: EvalRun }) {
  const result = run.result as Record<string, unknown> | undefined;
  const config = run.config as Record<string, unknown> | undefined;
  const output = (result?.output ?? {}) as Record<string, unknown>;
  const outputSchema = (config?.output_schema ?? []) as OutputFieldDef[];
  const summary = run.summary as Record<string, unknown> | undefined;
  const hasSchemaOutput = Object.keys(output).length > 0 && outputSchema.length > 0;
  const hasRawOutput = Object.keys(output).length > 0 && !hasSchemaOutput;

  return (
    <div className="space-y-4">
      {/* Results card: Score banner + Evaluator Output */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md">
        {/* Score banner */}
        {summary?.overall_score != null && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-muted)] uppercase font-semibold">Score</span>
            <span className="text-2xl font-bold" style={{ color: getScoreColor(summary.overall_score as number) }}>
              {formatScore(summary.overall_score as number)}
            </span>
          </div>
        )}

        {/* Output fields via OutputFieldRenderer */}
        {hasSchemaOutput && (
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
              Evaluator Output
            </h3>
            <OutputFieldRenderer schema={outputSchema} output={output} mode="card" />
          </div>
        )}

        {/* Fallback: raw output without schema */}
        {hasRawOutput && (
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
              Evaluator Output
            </h3>
            <div className="space-y-1.5">
              {Object.entries(output).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <span className="text-[var(--text-muted)] shrink-0 font-medium">{key}:</span>
                  <span className="text-[var(--text-primary)] break-words">
                    {typeof value === 'object' && value !== null
                      ? JSON.stringify(value, null, 2)
                      : String(value ?? '\u2014')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Score breakdown — only when no schema output (avoids duplication) */}
        {!hasSchemaOutput && !hasRawOutput && summary?.breakdown != null && (
          <div className="px-4 py-3">
            <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
              Score Breakdown
            </h3>
            <div className="space-y-1">
              {Object.entries(summary.breakdown as Record<string, unknown>).map(([key, val]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-[var(--text-muted)]">{key}</span>
                  <span className="text-[var(--text-primary)] font-medium">
                    {typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Reasoning */}
      {typeof summary?.reasoning === 'string' && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Reasoning
          </h3>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{summary.reasoning}</p>
        </div>
      )}

      {/* Raw data (collapsible card) */}
      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md">
        <details className="group">
          <summary className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] select-none">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Raw Request &amp; Response
          </summary>
          <div className="px-4 pb-3 space-y-3 border-t border-[var(--border-subtle)]">
            {typeof result?.rawRequest === 'string' && (
              <div className="pt-3">
                <p className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Prompt</p>
                <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                  {result.rawRequest}
                </pre>
              </div>
            )}
            {typeof result?.rawResponse === 'string' && (
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)] mb-1.5">Response</p>
                <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                  {result.rawResponse}
                </pre>
              </div>
            )}
            {typeof result?.rawRequest !== 'string' && typeof result?.rawResponse !== 'string' && (
              <div className="pt-3">
                <pre className="text-xs bg-[var(--bg-tertiary)] p-3 rounded overflow-auto max-h-48 text-[var(--text-secondary)]">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

/* ── Shared sub-components ───────────────────────────────── */

function StatCard({ label, value, color, beforeValue }: {
  label: string;
  value: string | number;
  color?: string;
  beforeValue?: string | number;
}) {
  const showDelta = beforeValue != null && String(beforeValue) !== String(value);
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3 py-2">
      <p className="text-xs text-[var(--text-muted)] uppercase font-semibold">{label}</p>
      {showDelta ? (
        <p className="text-lg font-bold mt-0.5 flex items-baseline gap-1">
          <span className="text-sm text-[var(--text-muted)] line-through">{beforeValue}</span>
          <span className="text-xs text-[var(--text-muted)]">→</span>
          <span style={{ color: color ?? 'var(--text-primary)' }}>{value}</span>
        </p>
      ) : (
        <p className="text-lg font-bold mt-0.5" style={{ color: color ?? 'var(--text-primary)' }}>
          {value}
        </p>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = (severity ?? 'none').toUpperCase();
  const styles: Record<string, { bg: string; text: string }> = {
    NONE: { bg: 'var(--surface-success)', text: 'var(--color-success)' },
    MINOR: { bg: 'var(--bg-tertiary)', text: 'var(--text-muted)' },
    MODERATE: { bg: 'var(--surface-warning)', text: 'var(--color-warning)' },
    CRITICAL: { bg: 'var(--surface-error)', text: 'var(--color-error)' },
  };
  const st = styles[s] ?? styles.MINOR;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase inline-block"
      style={{ backgroundColor: st.bg, color: st.text }}
    >
      {s === 'NONE' ? 'Match' : s}
    </span>
  );
}

function ReviewedStatPill({ totalItems }: { totalItems: number }) {
  const review = useInlineReviewOptional();
  const reviewedCount = useMemo(() => {
    if (!review) return 0;
    return Object.values(review.edits).filter((e) => e.decision !== '').length;
  }, [review]);

  if (!review || totalItems === 0) return null;

  return (
    <StatCard
      label="Reviewed"
      value={`${reviewedCount} / ${totalItems}`}
      color={reviewedCount > 0 ? 'var(--color-success)' : undefined}
    />
  );
}

function getScoreColor(value: number): string {
  const v = value > 1 ? value / 100 : value;
  if (v >= 0.7) return 'var(--color-success)';
  if (v >= 0.4) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatScore(value: number): string {
  if (value <= 1) return `${(value * 100).toFixed(0)}%`;
  return String(value);
}
