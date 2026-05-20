/* eslint-disable react-refresh/only-export-components --
 * Shared single-eval run-detail hook. Exports the hook plus internal helper
 * components in one file. Fast-refresh degrades to a full reload here —
 * accepted tradeoff to keep the dispatch readable. */
import { useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Code2, Info, X } from 'lucide-react';
import { Tooltip, RightSlideOverShell, ConfirmDialog } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { usePoll } from '@/hooks';
import {
  EvalRunVisibilityPanel,
  SelectionDiagnosticsPanel,
} from '@/features/evalRuns/components';
import VerdictBadge from '@/features/evalRuns/components/VerdictBadge';
import { RunProgressBar } from '@/features/evalRuns/components/RunProgressBar';
import {
  RunHeaderActions,
  ActionIconButton,
} from '@/features/evalRuns/components/RunHeaderActions';
import { useElapsedTime } from '@/features/evalRuns/hooks';
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { StartReviewButton } from '@/features/reviews/inline';
import {
  fetchEvalRun,
  fetchRunThreads,
  deleteEvalRun,
} from '@/services/api/evalRunsApi';
import { jobsApi, type Job } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { runsForApp, apiLogsForApp, runDetailForApp } from '@/config/routes';
import { formatDuration, timeAgo } from '@/utils/evalFormatters';
import { isActive, isReviewable } from '@/utils/runLifecycle';
import { scoreColor, getScoreBand } from '@/utils/scoreUtils';
import type { EvalRun, ThreadEvalRow, AppId } from '@/types';
import { RunDetailTabs, RunStatusBanner } from '../components';
import {
  CallQualityResults,
  CallQualityDrilldown,
  CallQualityCallNav,
  FullEvaluationResults,
  CustomEvalResults,
  getOverallScore,
} from '../resultRenderers';
import { useRunDetailState } from './useRunDetailState';
import { useAppRunDetailConfig } from './useAppRunDetailConfig';
import { useReviewMode } from './useReviewMode';
import type { RunDetailView } from '../types';

/** Generic header title for a single-eval run. Tries the run's `config.run_name`
 *  (set by batch-flow runs), then `batchMetadata.run_name`, then the evaluator
 *  name from `summary`/`config`, then a friendly fallback. */
function deriveRunTitle(run: EvalRun): string {
  const config = run.config as Record<string, unknown> | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const meta = run.batchMetadata as Record<string, unknown> | undefined;
  return (
    (config?.run_name as string) ??
    (meta?.run_name as string) ??
    (summary?.evaluator_name as string) ??
    (config?.evaluator_name as string) ??
    'Evaluation'
  );
}

/**
 * Hook that drives the run-detail surface for `runShape: 'single'` apps —
 * voice-rx and inside-sales today. Behaviour gates (raw payload overlay,
 * banner-only-on-failed diagnostics, drilldown sub-route, report-tab eval-type
 * gate, failure-headline-from-result) are all driven by
 * `App.config.runDetail`; there is no `appId === '...'` branch inside.
 *
 * App identity flows in via `appId` only for resource resolution — the
 * runs-list redirect on delete, the API-logs href, and the drilldown URL
 * template (`runDetailForApp(appId, runId)/<route>`).
 */
export function useSingleEvaluationRunDetail(
  appId: AppId,
  runId: string,
  callId: string | undefined,
): RunDetailView {
  const detailConfig = useAppRunDetailConfig(appId);
  const navigate = useNavigate();
  const { icon: pageIcon } = usePageMetadata('runDetail');
  const [threads, setThreads] = useState<ThreadEvalRow[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const drilldown = detailConfig.extras.drilldown;
  const wantThreads = !!drilldown;

  const { run, phase, error, refetch, setRun } = useRunDetailState<EvalRun>({
    runId,
    fetchRun: fetchEvalRun,
    isActive: (r) => isActive(r.status),
    pollIntervalMs: 3000,
    onRunFetched: async (r) => {
      if (wantThreads) {
        const threadData = await fetchRunThreads(r.id).catch(() => ({
          evaluations: [] as ThreadEvalRow[],
        }));
        setThreads(threadData.evaluations);
      }
    },
  });

  const runIsActive = run ? isActive(run.status) : false;
  const elapsed = useElapsedTime(
    activeJob?.startedAt ?? run?.startedAt ?? null,
    runIsActive,
  );

  // Job-progress poll runs alongside the run-level auto-poll the hook owns so
  // the progress bar updates more frequently than the run row itself needs to.
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
    enabled: runIsActive && !!runJobId,
  });

  const handleDelete = useCallback(async () => {
    if (!run) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(run.id);
      notificationService.success('Run deleted');
      navigate(runsForApp(appId));
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  }, [run, navigate, appId]);

  const handleCancel = useCallback(async () => {
    if (!run?.jobId) return;
    setCancelling(true);
    try {
      await jobsApi.cancel(run.jobId);
      setActiveJob((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
      setRun((prev) =>
        prev ? { ...prev, status: 'cancelled' as EvalRun['status'] } : prev,
      );
      await refetch();
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }, [run, refetch, setRun]);

  const isInReview = useReviewMode(run?.id);

  if (phase === 'loading') return { phase: 'loading' };
  if (phase === 'notFound') return { phase: 'notFound' };
  if (phase === 'error' || !run) {
    return { phase: 'error', message: error ?? 'Run not found' };
  }

  const runIsReviewable = isReviewable(run.status);

  const runMetaTooltip = (
    <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-muted)]">ID</span>
        <span className="font-mono text-[var(--text-primary)]">
          {run.id.slice(0, 12)}
        </span>
      </div>
      {run.startedAt && (
        <div>
          <span className="text-[var(--text-muted)]">Started </span>
          {timeAgo(run.startedAt)}
        </div>
      )}
      {run.durationMs != null && (
        <div>
          <span className="text-[var(--text-muted)]">Duration </span>
          {formatDuration(Math.round(run.durationMs / 1000))}
        </div>
      )}
      {run.llmModel && (
        <div>
          <span className="text-[var(--text-muted)]">Model </span>
          {run.llmProvider ? `${run.llmProvider}/${run.llmModel}` : run.llmModel}
        </div>
      )}
    </div>
  );

  const runSubtitle: ReactNode = (
    <>
      <VerdictBadge verdict={run.status} category="status" />
      <Tooltip content={runMetaTooltip} closeDelay={150}>
        <Info className="h-3.5 w-3.5 text-[var(--text-muted)] cursor-help" />
      </Tooltip>
    </>
  );

  const rawPayloadEnabled = !!detailConfig.extras.rawPayload;
  const rawPayloadButton = rawPayloadEnabled ? (
    <ActionIconButton
      icon={Code2}
      label="View raw payload"
      tooltip="View raw payload"
      onClick={() => setRawOpen(true)}
    />
  ) : null;

  const visibilityContent =
    isInReview || !runIsReviewable ? null : (
      <EvalRunVisibilityPanel
        runId={run.id}
        visibility={run.visibility ?? 'private'}
        ownerId={run.userId}
        mode="inline"
        onUpdated={(visibility) =>
          setRun((current) => (current ? { ...current, visibility } : current))
        }
      />
    );

  const reviewContent =
    isInReview || !runIsReviewable ? null : <StartReviewButton runId={run.id} />;

  const runActions = (
    <>
      {rawPayloadButton}
      <RunHeaderActions
        logsHref={`${apiLogsForApp(appId)}?run_id=${run.id}`}
        isActive={runIsActive}
        cancelling={cancelling}
        deleting={isDeleting}
        onCancel={handleCancel}
        onDelete={() => setDeleteOpen(true)}
        hideActions={isInReview}
        visibilityContent={visibilityContent}
        reviewContent={reviewContent}
      />
    </>
  );

  const callHrefFor = (threadId: string): string => {
    if (!drilldown) return '#';
    return `${runDetailForApp(appId, run.id)}/${drilldown.route.replace(`:${drilldown.paramName}`, threadId)}`;
  };

  if (callId && drilldown) {
    const selectedThread = threads.find((t) => t.thread_id === callId);
    if (!selectedThread) return { phase: 'loading' };

    // Call header derivation is call_quality-shaped today (rep_label / lead_id
    // / compliance booleans). Generalising to other drilldown shapes is a
    // separate refactor — the existing renderer registry is the right
    // extension point.
    const callResult = selectedThread.result as unknown as
      | Record<string, unknown>
      | undefined;
    const callMeta = callResult?.call_metadata as
      | Record<string, unknown>
      | undefined;
    const evals = callResult?.evaluations as
      | Array<Record<string, unknown>>
      | undefined;
    const evalOutput = evals?.[0]?.output as
      | Record<string, unknown>
      | undefined;
    const complianceGates = evalOutput
      ? Object.entries(evalOutput).filter(([, v]) => typeof v === 'boolean')
      : [];
    const allPassed = complianceGates.every(([, v]) => v === true);
    const overallScore = getOverallScore(selectedThread);
    const rep = (callMeta?.rep_label as string) || '—';
    const lead = (callMeta?.lead_id as string) || '—';

    const callMetaTooltip = (
      <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
        <div>
          <span className="text-[var(--text-muted)]">Run </span>
          <span className="font-mono text-[var(--text-primary)]">
            {run.id.slice(0, 12)}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Rep </span>
          {rep}
        </div>
        {typeof callMeta?.duration_seconds === 'number' && (
          <div>
            <span className="text-[var(--text-muted)]">Duration </span>
            {formatDuration(callMeta.duration_seconds)}
          </div>
        )}
        <div>
          <span className="text-[var(--text-muted)]">Score </span>
          <span style={{ color: scoreColor(overallScore) }}>
            {overallScore !== null ? `${overallScore}/100` : '—'}
          </span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Band </span>
          {overallScore !== null ? getScoreBand(overallScore) : '—'}
        </div>
        {complianceGates.length > 0 && (
          <div>
            <span className="text-[var(--text-muted)]">Compliance </span>
            <span
              style={{
                color: allPassed ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {allPassed ? 'Pass' : 'Fail'}
            </span>
          </div>
        )}
      </div>
    );

    const callSubtitle: ReactNode = (
      <>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ color: scoreColor(overallScore) }}
        >
          {overallScore !== null ? `${overallScore}/100` : '—'}
        </span>
        {complianceGates.length > 0 && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: allPassed ? 'var(--color-success)' : 'var(--color-error)',
              backgroundColor: allPassed
                ? 'var(--surface-success)'
                : 'var(--surface-error)',
            }}
          >
            {allPassed ? 'Compliance Pass' : 'Compliance Fail'}
          </span>
        )}
        <Tooltip content={callMetaTooltip} closeDelay={150}>
          <Info className="h-3.5 w-3.5 text-[var(--text-muted)] cursor-help" />
        </Tooltip>
      </>
    );

    return {
      phase: 'ready',
      reviewRunId: run.id,
      back: { to: runDetailForApp(appId, run.id), label: deriveRunTitle(run) },
      header: {
        icon: pageIcon,
        title: `${rep} → ${lead}`,
        subtitle: callSubtitle,
        actions: (
          <CallQualityCallNav
            thread={selectedThread}
            siblings={threads}
            getCallHref={callHrefFor}
          />
        ),
      },
      body: <CallQualityDrilldown thread={selectedThread} />,
    };
  }

  const failedStep = detailConfig.behaviour.failureHeadlineFromResult
    ? (run.result as Record<string, unknown> | undefined)?.failedStep
    : undefined;
  const failureHeadline =
    typeof failedStep === 'string' && failedStep
      ? `Failed during ${failedStep}`
      : 'Evaluation failed';

  const resultsBody = renderResultsBody({
    evalType: run.evalType,
    run,
    runId: run.id,
    threads,
    searchQuery,
    onSearchChange: setSearchQuery,
    getCallHref: callHrefFor,
  });

  const resultsTabLabel = wantThreads ? `Results (${threads.length})` : 'Results';

  const reportAllowedEvalTypes =
    detailConfig.reportTab.enabledForEvalTypes ?? detailConfig.evalTypes;
  const reportTab =
    detailConfig.reportTab.enabled &&
    reportAllowedEvalTypes.includes(run.evalType)
      ? {
          id: 'report',
          label: 'Report',
          content: (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AppReportTab appId={appId} runId={runId} runName={deriveRunTitle(run)} />
            </div>
          ),
        }
      : undefined;

  const rawOverlay = rawPayloadEnabled ? (
    <RightSlideOverShell
      isOpen={rawOpen}
      onClose={() => setRawOpen(false)}
      labelledBy="raw-payload-heading"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2
            id="raw-payload-heading"
            className="text-sm font-semibold text-[var(--text-primary)]"
          >
            Raw Payload
          </h2>
          <button
            type="button"
            onClick={() => setRawOpen(false)}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-secondary)]">
            {JSON.stringify(run.result ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </RightSlideOverShell>
  ) : null;

  const deleteDialog = (
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
  );

  return {
    phase: 'ready',
    reviewRunId: run.id,
    header: {
      icon: pageIcon,
      title: deriveRunTitle(run),
      subtitle: runSubtitle,
      actions: runActions,
    },
    body: (
      <>
        {runIsActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}
        <RunStatusBanner
          status={run.status}
          errorMessage={run.errorMessage}
          failureHeadline={failureHeadline}
        />
        {detailConfig.behaviour.bannerOnlyOnFailed && run.status === 'failed' && (
          <SelectionDiagnosticsPanel run={run} />
        )}
        <RunDetailTabs
          status={run.status}
          resultsTab={{ id: 'results', label: resultsTabLabel, content: resultsBody }}
          reportTab={reportTab}
        />
      </>
    ),
    dialogs: (
      <>
        {deleteDialog}
        {rawOverlay}
      </>
    ),
  };
}

/** Eval-type-keyed renderer dispatch. Switches over `run.evalType` are
 *  capability-keyed (per the registry); `appId` literals are not. */
function renderResultsBody(input: {
  evalType: EvalRun['evalType'];
  run: EvalRun;
  runId: string;
  threads: ThreadEvalRow[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  getCallHref: (threadId: string) => string;
}): ReactNode {
  const { evalType, run, runId, threads, searchQuery, onSearchChange, getCallHref } = input;
  switch (evalType) {
    case 'call_quality':
      return (
        <CallQualityResults
          runId={runId}
          runStatus={run.status}
          threads={threads}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          getCallHref={getCallHref}
        />
      );
    case 'full_evaluation':
      return <FullEvaluationResults run={run} />;
    case 'custom':
      return <CustomEvalResults run={run} />;
    default:
      return (
        <p className="text-sm text-[var(--text-muted)]">
          Unknown evaluation type: {evalType}
        </p>
      );
  }
}
