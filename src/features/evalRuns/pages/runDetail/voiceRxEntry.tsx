import { useState, useCallback } from 'react';
import { usePoll } from '@/hooks';
import { useNavigate } from 'react-router-dom';
import { Clock, Calendar, Code2, Cpu, Info, ListChecks, X } from 'lucide-react';
import { ConfirmDialog, RightSlideOverShell, Tooltip } from '@/components/ui';
import { isActive } from '@/utils/runLifecycle';
import { EvalRunVisibilityPanel, VerdictBadge, RunProgressBar } from '@/features/evalRuns/components';
import { RunHeaderActions, ActionIconButton } from '@/features/evalRuns/components/RunHeaderActions';
import { useElapsedTime } from '@/features/evalRuns/hooks';
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { StartReviewButton } from '@/features/reviews/inline';
import { fetchEvalRun, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi, type Job } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { routes } from '@/config/routes';
import { formatTimestamp, formatDuration } from '@/utils/evalFormatters';
import type { EvalRun } from '@/types';
import { RunDetailTabs, RunStatusBanner } from './components';
import { useRunDetailState } from './hooks';
import { FullEvaluationResults, CustomEvalResults } from './resultRenderers';
import type { RunDetailAppEntry, RunDetailView } from './types';

function useVoiceRxRunDetail(runId: string): RunDetailView {
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  const { run, phase, error, setRun } = useRunDetailState<EvalRun>({
    runId,
    fetchRun: fetchEvalRun,
    isActive: (r) => isActive(r.status),
  });

  const runIsActive = !!run && isActive(run.status);
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.startedAt ?? null, runIsActive);

  // Job-progress poll. Separate from the run-level auto-poll the hook owns.
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
  }, [activeJob, setRun]);

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

  if (phase === 'loading') {
    return { phase: 'loading' };
  }

  if (phase === 'notFound') {
    return { phase: 'notFound' };
  }

  if (phase === 'error' || !run) {
    return { phase: 'error', message: error ?? 'Run not found' };
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
      isActive={runIsActive}
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

  const failedStep = (run.result as Record<string, unknown> | undefined)?.failedStep;
  const failureHeadline = typeof failedStep === 'string' && failedStep
    ? `Failed during ${failedStep}`
    : 'Evaluation failed';

  const statusBanner = (
    <RunStatusBanner
      status={run.status}
      errorMessage={run.errorMessage}
      failureHeadline={failureHeadline}
    />
  );

  const rawPayloadButton = (
    <ActionIconButton
      icon={Code2}
      label="View raw payload"
      tooltip="View raw payload"
      onClick={() => setRawOpen(true)}
    />
  );

  const rawOverlay = (
    <RightSlideOverShell
      isOpen={rawOpen}
      onClose={() => setRawOpen(false)}
      labelledBy="raw-payload-heading"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <h2 id="raw-payload-heading" className="text-sm font-semibold text-[var(--text-primary)]">
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
  );

  const resultsTab = {
    id: 'results',
    label: 'Results',
    content: run.evalType === 'full_evaluation' ? (
      <FullEvaluationResults run={run} />
    ) : run.evalType === 'custom' ? (
      <CustomEvalResults run={run} />
    ) : (
      <p className="text-sm text-[var(--text-muted)]">
        Unknown evaluation type: {run.evalType}
      </p>
    ),
  };

  const reportTab = run.evalType === 'full_evaluation' && runId
    ? {
        id: 'report',
        label: 'Report',
        content: (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <AppReportTab appId="voice-rx" runId={runId} />
          </div>
        ),
      }
    : undefined;

  return {
    phase: 'ready',
    reviewRunId: run.id,
    header: {
      icon: ListChecks,
      title: evalName,
      subtitle,
      actions: (
        <>
          {rawPayloadButton}
          {actions}
        </>
      ),
    },
    body: (
      <>
        {runIsActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}
        {statusBanner}
        <RunDetailTabs
          status={run.status}
          resultsTab={resultsTab}
          reportTab={reportTab}
        />
      </>
    ),
    dialogs: (
      <>
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
        {rawOverlay}
      </>
    ),
  };
}

export const voiceRxRunDetailEntry: RunDetailAppEntry = {
  useRunDetail: useVoiceRxRunDetail,
};
