/* eslint-disable react-refresh/only-export-components --
 * Run-detail registry entry: exports a `RunDetailAppEntry` alongside the
 * helper component its body composes. Fast-refresh degrades to a full reload
 * for this file — accepted tradeoff. */
import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { EvalRunVisibilityPanel, SelectionDiagnosticsPanel } from '@/features/evalRuns/components';
import VerdictBadge from '@/features/evalRuns/components/VerdictBadge';
import { RunProgressBar } from '@/features/evalRuns/components/RunProgressBar';
import { RunHeaderActions } from '@/features/evalRuns/components/RunHeaderActions';
import { useElapsedTime } from '@/features/evalRuns/hooks';
import {
  useInlineReviewOptional,
  useInlineReviewNavigationGuard,
  StartReviewButton,
} from '@/features/reviews/inline';
import { fetchEvalRun, fetchRunThreads, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { routes } from '@/config/routes';
import { formatDuration } from '@/utils/formatters';
import { timeAgo } from '@/utils/evalFormatters';
import { isActive, isReviewable } from '@/utils/runLifecycle';
import { scoreColor, getScoreBand } from '@/utils/scoreUtils';
import type { EvalRun, ThreadEvalRow } from '@/types';
import type { Job } from '@/services/api/jobsApi';
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { useReviewModeStore } from '@/stores/reviewModeStore';
import { stripReviewItemPrefix } from '@/features/reviews/keys';
import { RunDetailTabs, RunStatusBanner } from './components';
import { useRunDetailState } from './hooks';
import { CallQualityResults, CallQualityDrilldown, getOverallScore } from './resultRenderers';
import type { RunDetailAppEntry, RunDetailView } from './types';

function getRunName(run: EvalRun): string {
  const config = run.config as Record<string, unknown> | undefined;
  const summary = run.summary as Record<string, unknown> | undefined;
  const meta = run.batchMetadata as Record<string, unknown> | undefined;
  return (
    (config?.run_name as string) ??
    (meta?.run_name as string) ??
    (summary?.evaluator_name as string) ??
    (config?.evaluator_name as string) ??
    'Call Quality Evaluation'
  );
}

function useInsideSalesRunDetail(runId: string, callId: string | undefined): RunDetailView {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<ThreadEvalRow[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const reviewActive = useReviewModeStore((s) => s.active);
  const reviewRunId = useReviewModeStore((s) => s.runId);

  const { run, phase, error, refetch, setRun } = useRunDetailState<EvalRun>({
    runId,
    fetchRun: fetchEvalRun,
    isActive: (r) => isActive(r.status),
    pollIntervalMs: 3000,
    onRunFetched: async (r) => {
      const [threadData, job] = await Promise.all([
        fetchRunThreads(r.id),
        isActive(r.status) && r.jobId ? jobsApi.get(r.jobId) : Promise.resolve(null),
      ]);
      setThreads(threadData.evaluations);
      setActiveJob(job);
    },
  });

  const runIsActive = run ? isActive(run.status) : false;
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.startedAt ?? null, runIsActive);

  const handleDelete = useCallback(async () => {
    if (!run) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(run.id);
      notificationService.success('Run deleted');
      navigate(routes.insideSales.runs);
    } catch {
      notificationService.error('Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [run, navigate]);

  const handleCancel = useCallback(async () => {
    if (!run?.jobId) return;
    setCancelling(true);
    try {
      await jobsApi.cancel(run.jobId);
      notificationService.success('Run cancelled');
      await refetch();
    } catch {
      notificationService.error('Cancel failed');
    } finally {
      setCancelling(false);
    }
  }, [run, refetch]);

  const { icon: pageIcon } = usePageMetadata('runDetail');

  if (phase === 'loading') {
    return { phase: 'loading' };
  }

  if (phase === 'notFound') {
    return { phase: 'notFound' };
  }

  if (phase === 'error' || !run) {
    return { phase: 'error', message: error ?? 'Run not found' };
  }

  const isInReview = reviewActive && reviewRunId === run.id;
  const runIsReviewable = isReviewable(run.status);

  const selectedThread = callId ? threads.find((t) => t.thread_id === callId) : null;

  const resultsTab = {
    id: 'results',
    label: `Results (${threads.length})`,
    content: (
      <CallQualityResults
        runId={run.id}
        runStatus={run.status}
        threads={threads}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        getCallHref={(threadId) => `/inside-sales/runs/${run.id}/calls/${threadId}`}
      />
    ),
  };

  const reportTab = {
    id: 'report',
    label: 'Report',
    content: (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <AppReportTab appId="inside-sales" runId={runId!} />
      </div>
    ),
  };

  const runMetaTooltip = (
    <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-muted)]">ID</span>
        <span className="font-mono text-[var(--text-primary)]">{run.id.slice(0, 8)}</span>
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
          {run.llmModel}
        </div>
      )}
    </div>
  );

  const runSubtitle = (
    <>
      <VerdictBadge verdict={run.status} category="status" />
      <Tooltip content={runMetaTooltip} closeDelay={150}>
        <Info className="h-3.5 w-3.5 text-[var(--text-muted)] cursor-help" />
      </Tooltip>
    </>
  );

  const runActions = (
    <RunHeaderActions
      logsHref={`${routes.insideSales.logs}?run_id=${run.id}`}
      isActive={runIsActive}
      cancelling={cancelling}
      deleting={isDeleting}
      onCancel={handleCancel}
      onDelete={handleDelete}
      hideActions={isInReview}
      visibilityContent={isInReview || !runIsReviewable ? null : (
        <EvalRunVisibilityPanel
          runId={run.id}
          visibility={run.visibility ?? 'private'}
          ownerId={run.userId}
          mode="inline"
          onUpdated={(visibility) => setRun((current) => (current ? { ...current, visibility } : current))}
        />
      )}
      reviewContent={isInReview || !runIsReviewable ? null : <StartReviewButton runId={run.id} />}
    />
  );

  let callTitle = 'Call';
  let callSubtitle: ReactNode = null;
  let callActions: ReactNode = null;
  if (selectedThread) {
    const callResult = selectedThread.result as unknown as Record<string, unknown> | undefined;
    const callMeta = callResult?.call_metadata as Record<string, unknown> | undefined;
    const evals = callResult?.evaluations as Array<Record<string, unknown>> | undefined;
    const evalOutput = evals?.[0]?.output as Record<string, unknown> | undefined;
    const complianceGates = evalOutput
      ? Object.entries(evalOutput).filter(([, v]) => typeof v === 'boolean')
      : [];
    const allPassed = complianceGates.every(([, v]) => v === true);
    const overallScore = getOverallScore(selectedThread);
    const rep = (callMeta?.rep_label as string) || '—';
    const lead = (callMeta?.lead_id as string) || '—';

    callTitle = `${rep} → ${lead}`;

    const callMetaTooltip = (
      <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
        <div>
          <span className="text-[var(--text-muted)]">Run </span>
          <span className="font-mono text-[var(--text-primary)]">{run.id.slice(0, 12)}</span>
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
            <span style={{ color: allPassed ? 'var(--color-success)' : 'var(--color-error)' }}>
              {allPassed ? 'Pass' : 'Fail'}
            </span>
          </div>
        )}
      </div>
    );

    callSubtitle = (
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
              backgroundColor: allPassed ? 'var(--surface-success)' : 'var(--surface-error)',
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

    callActions = (
      <CallNavActions run={run} thread={selectedThread} siblings={threads} />
    );
  }

  if (selectedThread) {
    return {
      phase: 'ready',
      reviewRunId: run.id,
      back: { to: routes.insideSales.runDetail(run.id), label: getRunName(run) },
      header: {
        icon: pageIcon,
        title: callTitle,
        subtitle: callSubtitle,
        actions: callActions,
      },
      body: <CallQualityDrilldown thread={selectedThread} />,
    };
  }

  return {
    phase: 'ready',
    reviewRunId: run.id,
    header: {
      icon: pageIcon,
      title: getRunName(run),
      subtitle: runSubtitle,
      actions: runActions,
    },
    body: (
      <>
        {runIsActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}
        <RunStatusBanner status={run.status} errorMessage={run.errorMessage} />
        {run.status === 'failed' && <SelectionDiagnosticsPanel run={run} />}
        <RunDetailTabs
          status={run.status}
          resultsTab={resultsTab}
          reportTab={reportTab}
        />
      </>
    ),
  };
}

export const insideSalesRunDetailEntry: RunDetailAppEntry = {
  useRunDetail: useInsideSalesRunDetail,
};

/* ── Call-variant header actions (prev/next thread nav) ─── */

function CallNavActions({
  run,
  thread,
  siblings,
}: {
  run: EvalRun;
  thread: ThreadEvalRow;
  siblings: ThreadEvalRow[];
}) {
  const navigate = useNavigate();
  const review = useInlineReviewOptional();
  const { confirmNavigation } = useInlineReviewNavigationGuard();

  const reviewContextItems = review?.context?.items;
  const inScopeCallIds = useMemo(() => {
    const set = new Set<string>();
    if (!reviewContextItems) return set;
    for (const item of reviewContextItems) {
      if (item.itemType !== 'call') continue;
      set.add(stripReviewItemPrefix(item.itemKey));
    }
    return set;
  }, [reviewContextItems]);

  if (siblings.length <= 1) return null;

  const currentIdx = siblings.findIndex((s) => s.thread_id === thread.thread_id);
  const prevThread = currentIdx > 0 ? siblings[currentIdx - 1] : null;
  const nextThread = currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;
  const goToThread = (id: string) => {
    const target = `/inside-sales/runs/${run.id}/calls/${id}`;
    if (inScopeCallIds.has(id)) {
      navigate(target);
      return;
    }
    confirmNavigation(() => navigate(target));
  };

  return (
    <span className="inline-flex items-center gap-0.5 border border-[var(--border-subtle)] rounded-md bg-[var(--bg-secondary)]">
      <button
        disabled={!prevThread}
        onClick={() => prevThread && goToThread(prevThread.thread_id)}
        className="p-1 disabled:opacity-30 hover:bg-[var(--interactive-secondary)] rounded-l-md transition-colors cursor-pointer disabled:cursor-default"
        title="Previous call"
      >
        <ArrowLeft size={14} />
      </button>
      <span className="text-[10px] tabular-nums px-1 border-x border-[var(--border-subtle)] text-[var(--text-secondary)]">
        {currentIdx + 1}/{siblings.length}
      </span>
      <button
        disabled={!nextThread}
        onClick={() => nextThread && goToThread(nextThread.thread_id)}
        className="p-1 disabled:opacity-30 hover:bg-[var(--interactive-secondary)] rounded-r-md transition-colors cursor-pointer disabled:cursor-default"
        title="Next call"
      >
        <ArrowLeft size={14} className="rotate-180" />
      </button>
    </span>
  );
}
