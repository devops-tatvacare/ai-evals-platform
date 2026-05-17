/* eslint-disable react-refresh/only-export-components --
 * Run-detail registry entry: this file exports a `RunDetailAppEntry` (the
 * registry contract) alongside the helper components its body renders.
 * Fast-refresh degrades to a full reload for this file — accepted tradeoff. */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePoll, useCurrentAppId } from "@/hooks";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, ClipboardList, Ban, AlertTriangle, Cpu, Thermometer, Calendar, FileText, Info, RotateCcw, Layers } from "lucide-react";
import { ConfirmDialog, Tooltip } from "@/components/ui";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { RunHeaderActions, ActionIconButton } from "../../components/RunHeaderActions";
import { RunDetailTabs, RunResultsEmptyState, RunResultsSearch } from "./components";
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
import {
  VerdictBadge,
  MetricInfo,
  EvalTable,
  getCellValue,
  DistributionBar,
  RunProgressBar,
  StatPill,
  EvalRunVisibilityPanel,
} from "../../components";
import AdversarialTable from "../../components/AdversarialTable";
import { AdversarialComparisonPanel } from "../../components/AdversarialComparisonPanel";
import { useElapsedTime } from "../../hooks";
import { CORRECTNESS_ORDER, EFFICIENCY_ORDER } from "@/utils/evalColors";
import { getLabelDefinition } from "@/config/labelDefinitions";
import { STATUS_COLORS } from "@/utils/statusColors";
import { isActive, isReviewable } from "@/utils/runLifecycle";
import { formatTimestamp, formatDuration, humanize, pct, formatMetric, normalizeLabel } from "@/utils/evalFormatters";
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { useInlineReviewOptional, useReviewTableData, getEffectiveAttribute, StartReviewButton } from '@/features/reviews/inline';
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

function AdversarialErrorBanner({ errors, total }: { errors: number; total: number }) {
  return (
    <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
      <span className="text-sm text-[var(--color-warning)] font-medium">
        {errors} of {total} test{total !== 1 ? "s" : ""} failed due to API errors (rate limits, timeouts, etc.). Pass rate and goal achievement exclude errored tests.
      </span>
    </div>
  );
}

function useKairaRunDetail(runId: string): RunDetailView {
  const navigate = useNavigate();
  const appId = useCurrentAppId();
  const { icon } = usePageMetadata('runDetail');
  const extraActions = useAppPageActions('runDetail');
  const adversarialRetrySettings = useAppSettingsStore((s) =>
    getAdversarialRetrySettings(appId, s.settings),
  );
  const timeouts = useGlobalSettingsStore((s) => s.timeouts);
  const [run, setRun] = useState<Run | null>(null);
  const [threadEvals, setThreadEvals] = useState<ThreadEvalRow[]>([]);
  const [adversarialEvals, setAdversarialEvals] = useState<AdversarialEvalRow[]>([]);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
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

  const isRunActive = run != null && isActive(run.status);
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.timestamp ?? null, isRunActive);

  const summaryErrors = (run?.summary?.errors as number) ?? 0;
  const summaryCompleted = (run?.summary?.completed as number) ?? 0;
  const summaryTotal = (run?.summary?.total_threads as number) ?? 0;
  const summarySkipped = (run?.summary?.skipped_previously_processed as number) ?? 0;
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
  }, [activeJob]);

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
    let cancelled = false;
    Promise.all([
      fetchRun(runId),
      fetchRunThreads(runId).catch(() => ({ evaluations: [] as ThreadEvalRow[] })),
      fetchRunAdversarial(runId).catch(() => ({ evaluations: [] as AdversarialEvalRow[] })),
    ])
      .then(([r, t, a]) => {
        if (!cancelled) {
          setRun(r);
          setThreadEvals(t.evaluations);
          setAdversarialEvals(a.evaluations);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load run");
        }
      });
    return () => { cancelled = true; };
  }, [runId]);

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

  const allVerdicts = useMemo(() => {
    const set = new Set<string>();
    for (const te of threadEvals) {
      if (te.worst_correctness) set.add(normalizeLabel(te.worst_correctness));
      if (te.efficiency_verdict) set.add(normalizeLabel(te.efficiency_verdict));

      const result = te.result as unknown as Record<string, unknown> | undefined;
      const customEvals = (result?.custom_evaluations ?? {}) as Record<string, Record<string, unknown>>;
      for (const [ceId, ce] of Object.entries(customEvals)) {
        if (ce.status !== 'completed' || !ce.output) continue;
        const desc = run?.evaluator_descriptors?.find(d => d.id === ceId);
        if (desc?.primaryField?.format === 'verdict') {
          const output = ce.output as Record<string, unknown>;
          const val = output[desc.primaryField.key];
          if (typeof val === 'string') set.add(normalizeLabel(val));
        }
      }
    }
    return Array.from(set);
  }, [threadEvals, run?.evaluator_descriptors]);

  const filteredThreads = useMemo(() => {
    return threadEvals.filter((te) => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !te.thread_id.toLowerCase().includes(q) &&
          !normalizeLabel(te.worst_correctness ?? "").toLowerCase().includes(q) &&
          !normalizeLabel(te.efficiency_verdict ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      if (verdictFilter.size > 0) {
        const builtInMatch = [te.worst_correctness, te.efficiency_verdict]
          .filter(Boolean)
          .some((v) => verdictFilter.has(normalizeLabel(v!)));

        let customMatch = false;
        const result = te.result as unknown as Record<string, unknown> | undefined;
        const customEvals = (result?.custom_evaluations ?? {}) as Record<string, Record<string, unknown>>;
        for (const [ceId, ce] of Object.entries(customEvals)) {
          if (ce.status !== 'completed' || !ce.output) continue;
          const desc = run?.evaluator_descriptors?.find(d => d.id === ceId);
          if (desc?.primaryField?.format === 'verdict') {
            const output = ce.output as Record<string, unknown>;
            const val = output[desc.primaryField.key];
            if (typeof val === 'string' && verdictFilter.has(normalizeLabel(val))) {
              customMatch = true;
              break;
            }
          }
        }

        if (!builtInMatch && !customMatch) return false;
      }
      return true;
    });
  }, [threadEvals, search, verdictFilter, run?.evaluator_descriptors]);

  const customEvalSummary = useMemo(() => {
    const raw = (run?.summary?.custom_evaluations ?? {}) as Record<string, {
      name: string;
      completed: number;
      errors: number;
      distribution?: Record<string, number>;
      average?: number;
    }>;
    return Object.entries(raw).map(([id, v]) => ({ id, ...v }));
  }, [run?.summary]);

  if (notFound) {
    return { phase: 'notFound' };
  }

  if (error) {
    return { phase: 'error', message: error };
  }

  if (!run) {
    return { phase: 'loading' };
  }

  const isInReview = reviewActive && reviewRunId === run.run_id;
  const runIsReviewable = isReviewable(run.status);

  const correctnessDist: Record<string, number> = {};
  const efficiencyDist: Record<string, number> = {};
  for (const te of threadEvals) {
    if (te.worst_correctness) {
      const n = normalizeLabel(te.worst_correctness);
      correctnessDist[n] = (correctnessDist[n] ?? 0) + 1;
    }
    if (te.efficiency_verdict) {
      const n = normalizeLabel(te.efficiency_verdict);
      efficiencyDist[n] = (efficiencyDist[n] ?? 0) + 1;
    }
  }

  const adversarialDist: Record<string, number> = {};
  for (const ae of adversarialEvals) {
    if (ae.verdict != null) {
      const n = normalizeLabel(ae.verdict);
      adversarialDist[n] = (adversarialDist[n] ?? 0) + 1;
    }
  }

  function toggleVerdictFilter(v: string) {
    setVerdictFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  // ── Shared pieces for surface + legacy returns ──────────
  const isAdversarialRun = adversarialEvals.length > 0;
  const sourceSummaryItems = isAdversarialRun ? describeAdversarialCaseSources(run.batch_metadata) : [];
  const canRetryFailures = isAdversarialRun && !isRunActive && retryableAdversarialEvalIds.length > 0;

  const runTypeLabel = isAdversarialRun
    ? 'Adversarial'
    : threadEvals.length > 0
      ? 'Batch'
      : null;

  const retryAction = isAdversarialRun && !isRunActive ? (
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
        <>
          <div className="shrink-0 space-y-4">
            <ReviewAwareSummarySection
              run={run}
              threadEvals={threadEvals}
              summaryTotal={summaryTotal}
              summarySkipped={summarySkipped}
              summaryErrors={summaryErrors}
              correctnessDist={correctnessDist}
              efficiencyDist={efficiencyDist}
              customEvalSummary={customEvalSummary}
            />

            <div className="flex items-center gap-2 flex-wrap">
              <RunResultsSearch
                status={run.status}
                resultCount={threadEvals.length}
                value={search}
                onChange={setSearch}
                placeholder="Search thread ID, verdict…"
                className="w-60 max-w-none"
              />
              <div className="flex gap-1 flex-wrap">
                {allVerdicts.map((v) => {
                  const def = getLabelDefinition(v, "correctness");
                  return (
                    <button
                      key={v}
                      onClick={() => toggleVerdictFilter(v)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${verdictFilter.has(v)
                        ? "bg-[var(--interactive-primary)] text-white border-[var(--interactive-primary)]"
                        : "bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                      }`}
                    >
                      {def.displayName}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-[var(--text-muted)] ml-auto">
                {filteredThreads.length}{filteredThreads.length !== threadEvals.length ? ` of ${threadEvals.length}` : ""} threads
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <ReviewAwareEvalTable evaluations={filteredThreads} evaluatorDescriptors={run.evaluator_descriptors} runId={run.run_id} />
          </div>
        </>
      )}

      {adversarialEvals.length > 0 && (
        <AdversarialSection
          evals={adversarialEvals}
          adversarialDist={adversarialDist}
          run={run}
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

  const reportContent = run ? (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <AppReportTab appId={appId} runId={run.run_id} />
    </div>
  ) : null;

  const historyContent = run ? (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <ReviewHistoryTab runId={run.run_id} />
    </div>
  ) : null;

  const baselineContent = run && adversarialEvals.length > 0 && !isRunActive ? (
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
  const showTabs = !isInReview && run && runIsReviewable;

  const tabbedBody = showTabs ? (
    <RunDetailTabs
      status={run.status}
      resultsTab={{ id: 'results', label: 'Results', content: resultsContent }}
      reportTab={{ id: 'report', label: 'Report', content: reportContent }}
      extraTabs={[
        {
          id: 'baseline',
          label: 'Baseline',
          content: baselineContent,
          visible: isAdversarialRun && !isRunActive,
        },
        { id: 'history', label: 'History', content: historyContent },
      ]}
    />
  ) : (
    resultsContent
  );

  const deleteDialog = run ? (
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
  ) : null;

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

function AdversarialSection({ evals, adversarialDist, run, isRunActive }: {
  evals: AdversarialEvalRow[];
  adversarialDist: Record<string, number>;
  run: Run;
  isRunActive: boolean;
}) {
  const { humanVerdicts } = useReviewTableData(run.run_id, { itemType: 'adversarial' });
  const canonicalCases = evals.map((evaluation) => ({
    evaluation,
    canonical: getCanonicalAdversarialCase(evaluation.result, evaluation),
  }));
  const infraCount = canonicalCases.filter(({ canonical }) => canonical.derived.isInfraFailure).length;
  const evaluatedCases = canonicalCases.filter(({ canonical }) => !canonical.derived.isInfraFailure);
  const successfulCount = evaluatedCases.length;
  const passRate = successfulCount > 0
    ? evaluatedCases.filter(({ canonical }) => canonical.judge.verdict === 'PASS').length / successfulCount
    : null;
  const goalRate = successfulCount > 0
    ? evaluatedCases.filter(({ canonical }) => canonical.judge.goalAchieved).length / successfulCount
    : null;
  const avgTurns = evals.length > 0
    ? canonicalCases.reduce((sum, { canonical, evaluation }) => sum + (canonical.facts.transcript.turnCount || evaluation.total_turns), 0) / evals.length
    : null;

  // Human-review recompute: substitute overridden verdicts through the shared
  // helper, then derive the same KPIs. `null` when no overrides exist so the
  // StatPills render the AI value plainly.
  const reviewedPassRate = useMemo(() => {
    if (!humanVerdicts || humanVerdicts.size === 0 || successfulCount === 0) return null;
    let hits = 0;
    for (const { canonical, evaluation } of evaluatedCases) {
      const verdict = getEffectiveAttribute(humanVerdicts, String(evaluation.id), 'verdict', canonical.judge.verdict);
      if (verdict === 'PASS') hits += 1;
    }
    return hits / successfulCount;
  }, [humanVerdicts, evaluatedCases, successfulCount]);

  const reviewedAdversarialDist = useMemo(() => {
    if (!humanVerdicts || humanVerdicts.size === 0) return null;
    const dist: Record<string, number> = {};
    for (const { canonical, evaluation } of evaluatedCases) {
      const verdict = getEffectiveAttribute(humanVerdicts, String(evaluation.id), 'verdict', canonical.judge.verdict) ?? 'UNKNOWN';
      dist[verdict] = (dist[verdict] ?? 0) + 1;
    }
    return dist;
  }, [humanVerdicts, evaluatedCases]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        {infraCount > 0 && !isRunActive && <AdversarialErrorBanner errors={infraCount} total={evals.length} />}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatPill label="Tests" metricKey="total_tests" value={evals.length} />
          <StatPill
            label="Pass Rate"
            metricKey="pass_rate"
            value={passRate != null ? pct(passRate) : "N/A"}
            humanValue={reviewedPassRate != null ? pct(reviewedPassRate) : undefined}
          />
          <StatPill label="Goal Achievement" metricKey="goal_achievement" value={goalRate != null ? pct(goalRate) : "N/A"} />
          <StatPill label="Infra Error Rate" value={pct(evals.length > 0 ? infraCount / evals.length : 0)} color={infraCount > 0 ? "var(--color-error)" : undefined} />
          <StatPill label="Avg Turns" metricKey="avg_turns" value={avgTurns != null ? avgTurns.toFixed(1) : 'N/A'} />
        </div>

        {Object.keys(adversarialDist).length > 0 && (
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">Verdicts</h3>
              {reviewedAdversarialDist && <span className="text-[10px] uppercase tracking-wider text-[var(--text-brand)] font-semibold">Reviewed</span>}
            </div>
            {reviewedAdversarialDist ? (
              <div className="space-y-2">
                <div className="opacity-60">
                  <p className="text-[10px] text-[var(--text-muted)] mb-0.5">AI</p>
                  <DistributionBar distribution={adversarialDist} />
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-brand)] mb-0.5">Reviewed</p>
                  <DistributionBar distribution={reviewedAdversarialDist} />
                </div>
              </div>
            ) : (
              <DistributionBar distribution={adversarialDist} />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <ReviewAwareAdversarialTable evaluations={evals} runId={run.run_id} />
      </div>
    </div>
  );
}

function ReviewAwareSummarySection({
  run,
  threadEvals,
  summaryTotal,
  summarySkipped,
  summaryErrors,
  correctnessDist,
  efficiencyDist,
  customEvalSummary,
}: {
  run: Run;
  threadEvals: ThreadEvalRow[];
  summaryTotal: number;
  summarySkipped: number;
  summaryErrors: number;
  correctnessDist: Record<string, number>;
  efficiencyDist: Record<string, number>;
  customEvalSummary: Array<{
    id: string;
    name: string;
    completed: number;
    errors: number;
    distribution?: Record<string, number>;
    average?: number;
  }>;
}) {
  const review = useInlineReviewOptional();
  const adjustedDistributions = useMemo(() => {
    if (!review) return null;

    const distributions = new Map<string, Record<string, number>>();
    let changed = false;
    const descriptors = run.evaluator_descriptors ?? [];

    for (const descriptor of descriptors) {
      if (descriptor.primaryField?.format !== 'verdict' || !descriptor.primaryField.key) {
        continue;
      }

      const distribution: Record<string, number> = {};
      for (const thread of threadEvals) {
        const { value, state } = getCellValue(thread, descriptor);
        if (state !== 'ok' || typeof value !== 'string') {
          continue;
        }

        const attributeKey = descriptor.type === 'built-in'
          ? descriptor.primaryField.key
          : `custom:${descriptor.id}:${descriptor.primaryField.key}`;
        const edit = review.getEdit(`thread:${thread.thread_id}`, attributeKey);
        const finalValue = edit?.decision === 'correct' && edit.reviewedValue != null
          ? edit.reviewedValue
          : value;

        if (finalValue !== value) {
          changed = true;
        }

        const normalized = normalizeLabel(finalValue);
        distribution[normalized] = (distribution[normalized] ?? 0) + 1;
      }

      distributions.set(descriptor.id, distribution);
    }

    if (!changed) {
      return null;
    }

    return distributions;
  }, [review, run.evaluator_descriptors, threadEvals]);

  const incompleteCount = threadEvals.filter((e) => normalizeLabel(e.efficiency_verdict ?? '') === 'INCOMPLETE').length;
  const evaluable = threadEvals.length - incompleteCount;
  const completedCount = threadEvals.filter((e) => e.success_status).length;
  const avgIntentAccuracy = (() => {
    const valid = threadEvals.filter((e) => e.intent_accuracy != null);
    return valid.length > 0 ? pct(valid.reduce((sum, thread) => sum + thread.intent_accuracy!, 0) / valid.length) : 'N/A';
  })();

  return (
    <>
      <div className={`grid gap-3 ${(run.evaluator_descriptors ?? []).filter(d => d.type === 'built-in' && (d.aggregation?.average != null || d.primaryField?.format === 'percentage')).length > 0 ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-4'}`}>
        <StatPill label="Threads" metricKey="total_threads" value={summaryTotal > 0 ? `${threadEvals.length} / ${summaryTotal}` : threadEvals.length} />
        {summarySkipped > 0 && <StatPill label="Skipped" value={summarySkipped} color="var(--text-muted)" />}
        {(run.evaluator_descriptors ?? [])
          .filter(d => d.type === 'built-in' && (d.aggregation?.average != null || d.primaryField?.format === 'percentage'))
          .slice(0, 2)
          .map(d => (
            <StatPill
              key={d.id}
              label={d.name}
              metricKey={d.id}
              value={d.aggregation?.average != null ? formatMetric(d.aggregation.average, d.primaryField?.format) : avgIntentAccuracy}
            />
          ))}
        {!(run.evaluator_descriptors?.length) && (
          <>
            <StatPill label="Avg Judge Intent Acc" metricKey="avg_intent_acc" value={avgIntentAccuracy} />
            <StatPill label="Completion Rate" metricKey="completion_rate" value={evaluable > 0 ? pct(completedCount / evaluable) : 'N/A'} />
            {incompleteCount > 0 && <StatPill label="Incomplete" value={incompleteCount} color="var(--text-muted)" />}
          </>
        )}
        {summaryErrors > 0 ? (
          <StatPill label="Errors" value={`${summaryErrors} / ${summaryTotal}`} color="var(--color-error)" />
        ) : (
          <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2">
            <div className="flex items-center gap-1">
              <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">Completed</p>
              <MetricInfo metricKey="completed" />
            </div>
            <p className="text-lg font-bold mt-0.5 leading-tight text-[var(--text-primary)]">{completedCount} / {evaluable}</p>
            {incompleteCount > 0 && (
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{incompleteCount} thread{incompleteCount > 1 ? 's' : ''} excluded (incomplete)</p>
            )}
          </div>
        )}
        <ReviewedStatPill />
      </div>

      <div className="flex gap-4 flex-wrap">
        {run.evaluator_descriptors
          ? run.evaluator_descriptors
            .filter(d => d.type === 'built-in' && d.primaryField?.format === 'verdict' && d.aggregation?.distribution && Object.keys(d.aggregation.distribution).length > 0)
            .map(d => {
              const adjustedDistribution = adjustedDistributions?.get(d.id);
              const hasChanged = adjustedDistribution && JSON.stringify(adjustedDistribution) !== JSON.stringify(d.aggregation!.distribution!);
              return (
                <div key={d.id} className="flex-1 min-w-[260px]">
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">{d.name}</h3>
                  <DistributionBar
                    distribution={hasChanged ? adjustedDistribution! : d.aggregation!.distribution!}
                    aiDistribution={hasChanged ? d.aggregation!.distribution! : undefined}
                    order={d.primaryField!.verdictOrder}
                  />
                </div>
              );
            })
          : (
            <>
              {Object.keys(correctnessDist).length > 0 && (
                <div className="flex-1 min-w-[260px]">
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Correctness</h3>
                  <DistributionBar
                    distribution={adjustedDistributions?.get('correctness') ?? correctnessDist}
                    aiDistribution={adjustedDistributions?.get('correctness') ? correctnessDist : undefined}
                    order={CORRECTNESS_ORDER}
                  />
                </div>
              )}
              {Object.keys(efficiencyDist).length > 0 && (
                <div className="flex-1 min-w-[260px]">
                  <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Efficiency</h3>
                  <DistributionBar
                    distribution={adjustedDistributions?.get('efficiency') ?? efficiencyDist}
                    aiDistribution={adjustedDistributions?.get('efficiency') ? efficiencyDist : undefined}
                    order={EFFICIENCY_ORDER}
                  />
                </div>
              )}
            </>
          )}
      </div>

      {customEvalSummary.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Custom Evaluators</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {customEvalSummary.map(({ id, name, completed, errors, distribution, average }) => {
              const adjustedDistribution = adjustedDistributions?.get(id);
              const hasChanged = adjustedDistribution && distribution && JSON.stringify(adjustedDistribution) !== JSON.stringify(distribution);
              return (
                <div
                  key={id}
                  className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2"
                  style={{ borderLeftWidth: 3, borderLeftColor: errors > 0 ? STATUS_COLORS.hardFail : STATUS_COLORS.pass }}
                >
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{name}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{completed} completed{errors > 0 ? `, ${errors} failed` : ""}</p>
                  {average != null && (
                    <p className="text-xs font-medium mt-1 text-[var(--text-primary)]">Avg: {formatMetric(average, run.evaluator_descriptors?.find(d => d.id === id)?.primaryField?.format)}</p>
                  )}
                  {distribution && Object.keys(distribution).length > 0 && (
                    <div className="mt-1.5">
                      <DistributionBar
                        distribution={hasChanged ? adjustedDistribution! : distribution}
                        aiDistribution={hasChanged ? distribution : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function ReviewAwareAdversarialTable({ evaluations, runId }: { evaluations: AdversarialEvalRow[]; runId: string }) {
  const { reviewableItems, reviewedIds, humanVerdicts } = useReviewTableData(runId, { itemType: 'adversarial' });
  return (
    <AdversarialTable
      evaluations={evaluations}
      runId={runId}
      reviewableItems={reviewableItems}
      reviewedIds={reviewedIds}
      humanVerdicts={humanVerdicts}
    />
  );
}

function ReviewAwareEvalTable({ evaluations, evaluatorDescriptors, runId }: { evaluations: ThreadEvalRow[]; evaluatorDescriptors?: import('@/types').EvaluatorDescriptor[]; runId: string }) {
  const { reviewableItems, reviewedIds, humanVerdicts } = useReviewTableData(runId, { itemType: 'thread' });
  return (
    <EvalTable
      evaluations={evaluations}
      evaluatorDescriptors={evaluatorDescriptors}
      reviewedThreadIds={reviewedIds}
      humanVerdicts={humanVerdicts}
      reviewableItems={reviewableItems}
    />
  );
}

function ReviewedStatPill() {
  const review = useInlineReviewOptional();
  if (!review?.context) return null;
  const totalItems = review.context.items.length;
  if (totalItems === 0) return null;
  const reviewedCount = review.context.items.filter(item =>
    item.attributes.some(attr => {
      const edit = review.getEdit(item.itemKey, attr.key);
      return edit && edit.decision !== '';
    })
  ).length;
  return (
    <StatPill
      label="Reviewed"
      metricKey="reviewed_items"
      value={`${reviewedCount} / ${totalItems}`}
      color="var(--text-brand)"
    />
  );
}
