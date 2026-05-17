/* eslint-disable react-refresh/only-export-components --
 * Run-detail registry entry: exports a `RunDetailAppEntry` alongside the
 * helper components its body composes. Fast-refresh degrades to a full
 * reload for this file — accepted tradeoff. */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRunDetailState, useAppRunDetailConfig } from "./hooks";
import { usePoll, useCurrentAppId } from "@/hooks";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, ClipboardList, Ban, AlertTriangle, Cpu, Thermometer, Calendar, FileText, Info, RotateCcw, Layers } from "lucide-react";
import { ConfirmDialog, Tooltip } from "@/components/ui";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { RunHeaderActions, ActionIconButton } from "../../components/RunHeaderActions";
import { RunDetailTabs, RunResultsEmptyState } from "./components";
import type { RunDetailAppEntry, RunDetailView } from "./types";
import type { Run, ThreadEvalRow, AdversarialEvalRow } from "@/types";
import {
  fetchRun,
  fetchRunThreads,
  fetchRunAdversarial,
  deleteRun,
} from "@/services/api/evalRunsApi";
import { ApiError } from "@/services/api/client";
import { jobsApi, type Job } from "@/services/api/jobsApi";
import { notificationService } from "@/services/notifications";
import { useJobTrackerStore } from "@/stores";
import { apiLogsForApp, runsForApp } from "@/config/routes";
import { usePageMetadata } from "@/config/pageMetadata";
import { useAppPageActions } from "@/features/pageActions/registry";
import { VerdictBadge, RunProgressBar, EvalRunVisibilityPanel } from "../../components";
import { AdversarialComparisonPanel } from "../../components/AdversarialComparisonPanel";
import { useElapsedTime } from "../../hooks";
import { isActive, isReviewable } from "@/utils/runLifecycle";
import { formatTimestamp, formatDuration, humanize } from "@/utils/evalFormatters";
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { StartReviewButton } from '@/features/reviews/inline';
import { ReviewHistoryTab } from '@/features/reviews/ReviewHistoryTab';
import { useSubmitAndRedirect } from '@/hooks/useSubmitAndRedirect';
import { useAppSettingsStore, useGlobalSettingsStore } from '@/stores';
import { useReviewModeStore } from '@/stores/reviewModeStore';
import {
  buildAdversarialRetryParams,
  canSubmitAdversarialRun,
  getAdversarialRetrySettings,
} from '../../utils/adversarialRunParams';
import { getCanonicalAdversarialCase } from '../../utils/adversarialCanonical';
import { BatchThreadResults, BatchAdversarialResults } from './resultRenderers';

function SuccessBanner({ durationSeconds }: { durationSeconds: number }) {
  return (
    <div className="bg-[var(--surface-success)] border border-[var(--border-success)] rounded-md px-4 py-2.5 flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0" />
      <span className="text-sm text-[var(--color-success)] font-medium">
        Evaluation completed in {formatDuration(durationSeconds)}
      </span>
    </div>
  );
}

function FailureBanner({ message }: { message: string }) {
  return (
    <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded-md px-4 py-2.5 flex items-center gap-2">
      <XCircle className="h-4 w-4 text-[var(--color-error)] shrink-0" />
      <div>
        <span className="text-sm text-[var(--color-error)] font-medium">
          Evaluation failed
        </span>
        {message && (
          <p className="text-xs text-[var(--color-error)] mt-0.5" style={{ opacity: 0.8 }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

function CancelledBanner({ durationSeconds }: { durationSeconds: number }) {
  return (
    <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 flex items-center gap-2">
      <Ban className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
      <span className="text-sm text-[var(--color-warning)] font-medium">
        Evaluation cancelled after {formatDuration(durationSeconds)}. Partial results may be shown below.
      </span>
    </div>
  );
}

function ErrorWarningBanner({ errors, total, completed }: { errors: number; total: number; completed: number }) {
  return (
    <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
      <span className="text-sm text-[var(--color-warning)] font-medium">
        {errors} of {total} thread evaluations failed. Results below are from the {completed} thread{completed !== 1 ? "s" : ""} that succeeded.
      </span>
    </div>
  );
}

function useKairaRunDetail(runId: string): RunDetailView {
  const navigate = useNavigate();
  const appId = useCurrentAppId();
  const detailConfig = useAppRunDetailConfig('kaira-bot');
  const { icon } = usePageMetadata('runDetail');
  const extraActions = useAppPageActions('runDetail');
  const adversarialRetrySettings = useAppSettingsStore((s) =>
    getAdversarialRetrySettings(appId, s.settings),
  );
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const [threadEvals, setThreadEvals] = useState<ThreadEvalRow[]>([]);
  const [adversarialEvals, setAdversarialEvals] = useState<AdversarialEvalRow[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reviewActive = useReviewModeStore((s) => s.active);
  const reviewRunId = useReviewModeStore((s) => s.runId);

  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const lastProgressRef = useRef(-1);
  const { submit: submitAdversarialRetry, isSubmitting: retryingFailedCases } = useSubmitAndRedirect({
    appId,
    label: 'Adversarial Retry',
    successMessage: 'Adversarial retry submitted. It will appear in the runs list shortly.',
    fallbackRoute: runsForApp(appId),
    onClose: () => {},
  });

  // Kaira owns its own job-progress poll below (the sole driver of dependent-
  // row refetches when progress changes). The hook handles initial run fetch
  // + 404 / error mapping only — `pollWhileActive: false` keeps the run-level
  // poll off so we don't double-refetch.
  const { run, phase, error, setRun } = useRunDetailState<Run>({
    runId,
    fetchRun,
    isActive: (r) => isActive(r.status),
    pollWhileActive: false,
    isNotFound: (e) => e instanceof ApiError && e.status === 404,
    onRunFetched: async (r) => {
      const [t, a] = await Promise.all([
        fetchRunThreads(r.run_id).catch(() => ({ evaluations: [] as ThreadEvalRow[] })),
        fetchRunAdversarial(r.run_id).catch(() => ({ evaluations: [] as AdversarialEvalRow[] })),
      ]);
      setThreadEvals(t.evaluations);
      setAdversarialEvals(a.evaluations);
    },
  });

  const isRunActive = run != null && isActive(run.status);
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.timestamp ?? null, isRunActive);

  const summaryErrors = (run?.summary?.errors as number) ?? 0;
  const summaryCompleted = (run?.summary?.completed as number) ?? 0;
  const summaryTotal = (run?.summary?.total_threads as number) ?? 0;
  const retryableAdversarialEvalIds = useMemo(
    () =>
      adversarialEvals
        .filter((evaluation) => Boolean(getCanonicalAdversarialCase(evaluation.result, evaluation).derived.isRetryable))
        .map((evaluation) => evaluation.id),
    [adversarialEvals],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!runId || !run) return;
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await deleteRun(runId);
      navigate(runsForApp(appId), { replace: true });
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Unknown error', "Delete failed");
      setDeleting(false);
    }
  }, [runId, run, navigate, appId]);

  const handleCancel = useCallback(async () => {
    if (!activeJob) return;
    setCancelling(true);
    try {
      await jobsApi.cancel(activeJob.id);
      setActiveJob((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
      setRun((prev) => prev ? { ...prev, status: 'CANCELLED' as Run['status'] } : prev);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Unknown error', "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }, [activeJob, setRun]);

  const handleRetryFailedCases = useCallback(async () => {
    if (!run) return;
    if (!adversarialRetrySettings || !canSubmitAdversarialRun(adversarialRetrySettings, run)) {
      notificationService.error(
        'Configure the required API URL and credential row before retrying adversarial cases.',
        'Missing app settings',
      );
      return;
    }
    if (retryableAdversarialEvalIds.length === 0) {
      notificationService.info('There are no failed adversarial cases to retry in this run.');
      return;
    }

    await submitAdversarialRetry(
      'evaluate-adversarial',
      buildAdversarialRetryParams({
        run,
        kairaSettings: adversarialRetrySettings,
        timeouts,
        retryEvalIds: retryableAdversarialEvalIds,
        sourceRunId: run.run_id,
        nameSuffix: ' Failed Case Retry',
      }),
    );
  }, [
    adversarialRetrySettings,
    retryableAdversarialEvalIds,
    run,
    submitAdversarialRetry,
    timeouts,
  ]);

  useEffect(() => {
    if (!runId) return;
    const { activeJobs, untrackJob } = useJobTrackerStore.getState();
    const match = activeJobs.find((j) => j.runId === runId);
    if (match) untrackJob(match.jobId);
  }, [runId]);

  const runJobId = run?.job_id ?? null;
  const runStatus = run?.status ?? null;
  usePoll({
    fn: async () => {
      if (!runJobId || !runId) return false;

      const job = await jobsApi.get(runJobId);
      setActiveJob(job);

      const currentProgress = job.progress?.current ?? -1;

      if (currentProgress !== lastProgressRef.current) {
        lastProgressRef.current = currentProgress;
        try {
          const [t, a] = await Promise.all([
            fetchRunThreads(runId).catch(() => ({ evaluations: [] as ThreadEvalRow[] })),
            fetchRunAdversarial(runId).catch(() => ({ evaluations: [] as AdversarialEvalRow[] })),
          ]);
          setThreadEvals(t.evaluations);
          setAdversarialEvals(a.evaluations);
        } catch {
          // Incremental fetch failed — continue polling
        }
      }

      if (["completed", "failed", "cancelled"].includes(job.status)) {
        try {
          const r = await fetchRun(runId);
          if (r.status.toLowerCase() === "running") {
            r.status = job.status === "cancelled" ? "CANCELLED" : "FAILED";
            if (!r.error_message) {
              r.error_message = job.status === "cancelled"
                ? "Evaluation was cancelled"
                : "Evaluation failed (job ended unexpectedly)";
            }
          }
          setRun(r);
        } catch {
          // Run data refresh failed, still stop polling
        }
        if (job.status === "completed") {
          setShowSuccessBanner(true);
          setTimeout(() => setShowSuccessBanner(false), 8000);
        }
        lastProgressRef.current = -1;
        return false;
      }

      return true;
    },
    enabled: !!runStatus && isActive(runStatus) && !!runJobId,
  });

  if (phase === 'notFound') {
    return { phase: 'notFound' };
  }

  if (phase === 'error') {
    return { phase: 'error', message: error ?? 'Failed to load run' };
  }

  if (!run) {
    return { phase: 'loading' };
  }

  const isInReview = reviewActive && reviewRunId === run.run_id;
  const runIsReviewable = isReviewable(run.status);
  const isAdversarialRun = adversarialEvals.length > 0;
  const sourceSummaryItems = isAdversarialRun ? describeAdversarialCaseSources(run.batch_metadata) : [];
  const canRetryFailures = isAdversarialRun && !isRunActive && retryableAdversarialEvalIds.length > 0;

  const runTypeLabel = isAdversarialRun
    ? 'Adversarial'
    : threadEvals.length > 0
      ? 'Batch'
      : null;

  const retryAction = detailConfig.extras.adversarialAxes && isAdversarialRun && !isRunActive ? (
    <>
      <PermissionGate action="evaluation:run">
        <ActionIconButton
          icon={RotateCcw}
          label="Retry errored cases"
          tooltip={
            canRetryFailures
              ? `Retry ${retryableAdversarialEvalIds.length} errored case${retryableAdversarialEvalIds.length === 1 ? '' : 's'}`
              : 'No retryable errored cases'
          }
          onClick={() => setShowRetryConfirm(true)}
          disabled={!canRetryFailures}
          spinning={retryingFailedCases}
        />
      </PermissionGate>
      <ConfirmDialog
        isOpen={showRetryConfirm}
        onClose={() => setShowRetryConfirm(false)}
        onConfirm={() => {
          setShowRetryConfirm(false);
          void handleRetryFailedCases();
        }}
        title="Retry Failed Cases"
        description={`This will re-run ${retryableAdversarialEvalIds.length} failed case${retryableAdversarialEvalIds.length === 1 ? '' : 's'} against the live bot with the same parameters. A new evaluation run will be created.`}
        confirmLabel="Retry"
        variant="warning"
        isLoading={retryingFailedCases}
      />
    </>
  ) : null;

  const banners = (
    <>
      {isRunActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}
      {showSuccessBanner && <SuccessBanner durationSeconds={run.duration_seconds} />}
      {run.status.toLowerCase() === "failed" && run.error_message && !isRunActive && (
        <FailureBanner message={run.error_message} />
      )}
      {run.status.toLowerCase() === "cancelled" && (
        <CancelledBanner durationSeconds={run.duration_seconds} />
      )}
      {summaryErrors > 0 && summaryCompleted > 0 && !isRunActive && (
        <ErrorWarningBanner errors={summaryErrors} total={summaryTotal} completed={summaryCompleted} />
      )}
    </>
  );

  const metadataTooltip = (
    <div className="flex flex-col gap-2 text-xs">
      {runTypeLabel && (
        <div className="flex items-center gap-2">
          <Layers className="h-3 w-3 text-[var(--text-muted)]" />
          <span className="w-[72px] text-[var(--text-muted)]">Type</span>
          <span className="text-[var(--text-primary)]">{runTypeLabel}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="w-[72px] text-[var(--text-muted)] ml-5">Run ID</span>
        <span className="font-mono text-[var(--text-primary)]">{run.run_id}</span>
      </div>
      <div className="flex items-center gap-2">
        <Calendar className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="w-[72px] text-[var(--text-muted)]">Started</span>
        <span className="text-[var(--text-primary)]">{formatTimestamp(run.timestamp)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Clock className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="w-[72px] text-[var(--text-muted)]">Duration</span>
        <span className="text-[var(--text-primary)]">
          {isRunActive ? elapsed || "—" : formatDuration(run.duration_seconds)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Cpu className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="w-[72px] text-[var(--text-muted)]">Model</span>
        <span className="text-[var(--text-primary)]">{run.llm_provider}/{run.llm_model}</span>
      </div>
      <div className="flex items-center gap-2">
        <Thermometer className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="w-[72px] text-[var(--text-muted)]">Temperature</span>
        <span className="text-[var(--text-primary)]">{run.eval_temperature}</span>
      </div>
      {run.data_path && (
        <div className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
          <span className="w-[72px] text-[var(--text-muted)]">Data path</span>
          <span className="text-[var(--text-primary)] truncate max-w-[220px]">{run.data_path}</span>
        </div>
      )}
      {isAdversarialRun && sourceSummaryItems.length > 0 && (
        <div className="flex items-start gap-2 pt-1 border-t border-[var(--border-subtle)]">
          <ClipboardList className="h-3 w-3 text-[var(--text-muted)] shrink-0 mt-0.5" />
          <span className="w-[72px] text-[var(--text-muted)] shrink-0">Case sources</span>
          <div className="flex flex-wrap gap-1">
            {sourceSummaryItems.map((item) => (
              <span
                key={item}
                className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const metadataStrip = (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <VerdictBadge verdict={run.status} category="status" />
      <Tooltip content={metadataTooltip} position="bottom" maxWidth={360} closeDelay={150}>
        <button
          type="button"
          aria-label="Run details"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );

  const headerActions = (
    <RunHeaderActions
      logsHref={`${apiLogsForApp(appId)}?run_id=${run.run_id}`}
      isActive={isRunActive}
      cancelling={cancelling}
      deleting={deleting}
      onCancel={handleCancel}
      onDelete={() => setConfirmDelete(true)}
      hideActions={isInReview}
      visibilityContent={isInReview || !runIsReviewable ? null : (
        <EvalRunVisibilityPanel
          runId={run.run_id}
          visibility={run.visibility ?? 'private'}
          ownerId={run.userId}
          mode="inline"
          onUpdated={(visibility) => setRun((current) => (
            current
              ? { ...current, visibility, shared_by: visibility === 'shared' ? current.shared_by : null, shared_at: visibility === 'shared' ? current.shared_at : null }
              : current
          ))}
        />
      )}
      reviewContent={isInReview || !runIsReviewable ? null : <StartReviewButton runId={run.run_id} />}
      retryContent={retryAction}
    />
  );

  const resultsContent = (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      {threadEvals.length > 0 && (
        <BatchThreadResults run={run} threadEvals={threadEvals} />
      )}

      {adversarialEvals.length > 0 && (
        <BatchAdversarialResults
          run={run}
          adversarialEvals={adversarialEvals}
          isRunActive={isRunActive}
        />
      )}

      {threadEvals.length === 0 && adversarialEvals.length === 0 && (
        <RunResultsEmptyState
          status={run.status}
          hasAnyData={false}
          hasFilteredData={false}
          emptyIcon={ClipboardList}
          emptyTitle="No evaluations found"
          emptyMessage="This run has no evaluation results yet."
          processingMessage="Results will appear here as threads are evaluated."
        />
      )}
    </div>
  );

  const reportContent = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <AppReportTab appId={appId} runId={run.run_id} />
    </div>
  );

  const historyContent = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <ReviewHistoryTab runId={run.run_id} />
    </div>
  );

  const baselineContent = detailConfig.extras.adversarialAxes && adversarialEvals.length > 0 && !isRunActive ? (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <AdversarialComparisonPanel
        currentRunId={run.run_id}
        currentRunName={run.name || 'Current adversarial run'}
        currentRunCreatedAt={run.timestamp}
        currentEvaluations={adversarialEvals}
      />
    </div>
  ) : null;

  // Kaira applies a stricter gate than `RunDetailTabs`: tabs only mount when
  // the run is reviewable AND the surface isn't in inline-review mode. When
  // not gated, the bare results body renders without the tab strip.
  const showTabs = !isInReview && runIsReviewable;

  const reportAllowedEvalTypes = detailConfig.reportTab.enabledForEvalTypes ?? detailConfig.evalTypes;
  // Kaira runs don't carry `eval_type` on the Run row — the renderer is picked
  // from data shape — so honour `reportTab.enabled` on its own here.
  void reportAllowedEvalTypes;
  const reportTabEnabled = detailConfig.reportTab.enabled;
  const baselineEnabled = !!detailConfig.extras.adversarialAxes && isAdversarialRun && !isRunActive;
  const historyEnabled = !!detailConfig.extras.historyTab;

  const tabbedBody = showTabs ? (
    <RunDetailTabs
      status={run.status}
      resultsTab={{ id: 'results', label: 'Results', content: resultsContent }}
      reportTab={reportTabEnabled
        ? { id: 'report', label: 'Report', content: reportContent }
        : undefined}
      extraTabs={[
        {
          id: 'baseline',
          label: 'Baseline',
          content: baselineContent,
          visible: baselineEnabled,
        },
        ...(historyEnabled
          ? [{ id: 'history', label: 'History', content: historyContent }]
          : []),
      ]}
    />
  ) : (
    resultsContent
  );

  const deleteDialog = (
    <ConfirmDialog
      isOpen={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      onConfirm={handleDeleteConfirm}
      title="Delete Evaluation Run"
      description={`Delete run ${run.run_id.slice(0, 12)}... and all its evaluations? This cannot be undone.`}
      confirmLabel={deleting ? "Deleting..." : "Delete"}
      variant="danger"
      isLoading={deleting}
    />
  );

  return {
    phase: 'ready',
    reviewRunId: run.run_id,
    header: {
      icon,
      title: run.name || run.command,
      subtitle: metadataStrip,
      actions: (
        <>
          {extraActions}
          {headerActions}
        </>
      ),
    },
    body: (
      <>
        {banners}
        {tabbedBody}
      </>
    ),
    dialogs: deleteDialog,
  };
}

export const kairaRunDetailEntry: RunDetailAppEntry = {
  useRunDetail: useKairaRunDetail,
};

function describeAdversarialCaseSources(batchMetadata?: Record<string, unknown>): string[] {
  const sourceSummary = batchMetadata?.case_source_summary as Record<string, unknown> | undefined;
  if (!sourceSummary) return [];

  const items: string[] = [];
  if (typeof sourceSummary.case_mode === 'string') {
    items.push(`Mode: ${humanize(sourceSummary.case_mode)}`);
  }
  if (typeof sourceSummary.generated_count === 'number' && sourceSummary.generated_count > 0) {
    items.push(`${sourceSummary.generated_count} generated`);
  }
  if (typeof sourceSummary.saved_count === 'number' && sourceSummary.saved_count > 0) {
    items.push(`${sourceSummary.saved_count} saved`);
  }
  if (typeof sourceSummary.manual_count === 'number' && sourceSummary.manual_count > 0) {
    items.push(`${sourceSummary.manual_count} run-only`);
  }
  if (typeof sourceSummary.retry_count === 'number' && sourceSummary.retry_count > 0) {
    items.push(`${sourceSummary.retry_count} retried`);
  }
  if (typeof sourceSummary.pinned_count === 'number' && sourceSummary.pinned_count > 0) {
    items.push(`${sourceSummary.pinned_count} pinned`);
  }
  return items;
}
