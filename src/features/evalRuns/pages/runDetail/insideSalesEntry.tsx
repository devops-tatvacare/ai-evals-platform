/* eslint-disable react-refresh/only-export-components --
 * Run-detail registry entry: this file exports a `RunDetailAppEntry` (the
 * registry contract) alongside the helper components its body renders.
 * Fast-refresh degrades to a full reload for this file — accepted tradeoff. */
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Phone,
  Search,
  Info,
} from 'lucide-react';
import { Tooltip, EmptyState } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { EvalRunVisibilityPanel, StatPill } from '@/features/evalRuns/components';
import VerdictBadge from '@/features/evalRuns/components/VerdictBadge';
import { RunProgressBar } from '@/features/evalRuns/components/RunProgressBar';
import { RunHeaderActions } from '@/features/evalRuns/components/RunHeaderActions';
import { useElapsedTime } from '@/features/evalRuns/hooks';
import DistributionBar from '@/features/evalRuns/components/DistributionBar';
import {
  useInlineReviewOptional,
  InlineReviewControls, useInlineReviewNavigationGuard,
  useReviewTableData, getEffectiveAttribute,
  StartReviewButton,
} from '@/features/reviews/inline';
import { fetchEvalRun, fetchRunThreads, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { usePoll } from '@/hooks';
import { routes } from '@/config/routes';
import { formatDuration } from '@/utils/formatters';
import { timeAgo } from '@/utils/evalFormatters';
import { isActiveStatus } from '@/utils/runStatus';
import { scoreColor, getScoreBand } from '@/utils/scoreUtils';
import { CallResultPanel } from '@/features/crmWorkspace/components/CallResultPanel';
import type { EvalRun, ThreadEvalRow } from '@/types';
import type { Job } from '@/services/api/jobsApi';
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { useReviewModeStore } from '@/stores/reviewModeStore';
import { stripReviewItemPrefix } from '@/features/reviews/keys';
import { RunDetailTabStrip } from './RunDetailTabStrip';
import type { RunDetailAppEntry, RunDetailView } from './types';

/* ── Helpers ─────────────────────────────────────────────── */

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

function getOverallScore(thread: ThreadEvalRow): number | null {
  const result = thread.result as unknown as Record<string, unknown> | undefined;
  if (!result) return null;
  // Score lives in evaluations[0].output.overall_score
  const evals = result.evaluations as Array<Record<string, unknown>> | undefined;
  if (evals && evals.length > 0) {
    const output = evals[0].output as Record<string, unknown> | undefined;
    if (output && typeof output.overall_score === 'number') return output.overall_score;
  }
  // Fallback: check top-level output
  const output = result.output as Record<string, unknown> | undefined;
  if (output && typeof output.overall_score === 'number') return output.overall_score;
  return null;
}

/* ── Main Component ──────────────────────────────────────── */

function useInsideSalesRunDetail(runId: string, callId: string | undefined): RunDetailView {
  const navigate = useNavigate();
  const [run, setRun] = useState<EvalRun | null>(null);
  const [threads, setThreads] = useState<ThreadEvalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const reviewActive = useReviewModeStore((s) => s.active);
  const reviewRunId = useReviewModeStore((s) => s.runId);

  const fetchData = useCallback(async () => {
    if (!runId) return;
    try {
      const [runData, threadData] = await Promise.all([
        fetchEvalRun(runId),
        fetchRunThreads(runId),
      ]);
      setRun(runData);
      setThreads(threadData.evaluations);
      setError(null);

      // Fetch active job if running
      if (isActiveStatus(runData.status) && runData.jobId) {
        const job = await jobsApi.get(runData.jobId);
        setActiveJob(job);
      } else {
        setActiveJob(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Poll while active
  const isActive = run ? isActiveStatus(run.status) : false;
  usePoll({ fn: async () => { await fetchData(); return true; }, enabled: isActive, intervalMs: 3000 });

  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.startedAt ?? null, isActive);

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
      fetchData();
    } catch {
      notificationService.error('Cancel failed');
    } finally {
      setCancelling(false);
    }
  }, [run, fetchData]);

  // Must be above early returns — Rules of Hooks
  const filteredThreads = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return threads;
    return threads.filter((t) => {
      const meta = (t.result as unknown as Record<string, unknown>)?.call_metadata as Record<string, unknown> | undefined;
      const agent = (meta?.agent as string) || '';
      const lead = (meta?.lead as string) || '';
      return agent.toLowerCase().includes(q) || lead.toLowerCase().includes(q) || t.thread_id.includes(q);
    });
  }, [threads, searchQuery]);

  const { icon: pageIcon } = usePageMetadata('runDetail');

  if (loading) {
    return { phase: 'loading' };
  }

  if (error || !run) {
    return { phase: 'error', message: error || 'Run not found' };
  }

  // Compute stats from threads
  const evaluated = threads.filter((t) => t.success_status).length;
  const failed = threads.length - evaluated;
  const scores = threads.map(getOverallScore).filter((s): s is number => s !== null);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const scoreBands: Record<string, number> = { Strong: 0, Good: 0, 'Needs work': 0, Poor: 0 };
  scores.forEach((s) => { scoreBands[getScoreBand(s)]++; });
  const isInReview = reviewActive && reviewRunId === run.id;
  const isReviewable = !isActive && ['completed', 'completed_with_errors'].includes(run.status.toLowerCase());

  const resultsTab = {
    id: 'results',
    label: `Results (${threads.length})`,
    content: (
      <ResultsTabContent
        threads={threads}
        filteredThreads={filteredThreads}
        evaluated={evaluated}
        failed={failed}
        scores={scores}
        avgScore={avgScore}
        scoreBands={scoreBands}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        isActive={isActive}
        runId={run.id}
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

  // If callId is present, show call eval detail inside the same PageSurface shell
  const selectedThread = callId ? threads.find((t) => t.thread_id === callId) : null;

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
      isActive={isActive}
      cancelling={cancelling}
      deleting={isDeleting}
      onCancel={handleCancel}
      onDelete={handleDelete}
      hideActions={isInReview}
      visibilityContent={isInReview || !isReviewable ? null : (
        <EvalRunVisibilityPanel
          runId={run.id}
          visibility={run.visibility ?? 'private'}
          ownerId={run.userId}
          mode="inline"
          onUpdated={(visibility) => setRun((current) => (current ? { ...current, visibility } : current))}
        />
      )}
      reviewContent={isInReview || !isReviewable ? null : <StartReviewButton runId={run.id} />}
    />
  );

  // Call-variant header computations — only meaningful when selectedThread is set.
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
    const agent = (callMeta?.agent as string) || '—';
    const lead = (callMeta?.lead as string) || '—';

    callTitle = `${agent} → ${lead}`;

    const callMetaTooltip = (
      <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
        <div>
          <span className="text-[var(--text-muted)]">Run </span>
          <span className="font-mono text-[var(--text-primary)]">{run.id.slice(0, 12)}</span>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Agent </span>
          {agent}
        </div>
        {typeof callMeta?.duration === 'number' && (
          <div>
            <span className="text-[var(--text-muted)]">Duration </span>
            {formatDuration(callMeta.duration)}
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
      body: <CallEvalDetail thread={selectedThread} />,
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
        {isActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}
        <RunDetailTabStrip tabs={[resultsTab, reportTab]} />
      </>
    ),
  };
}

export const insideSalesRunDetailEntry: RunDetailAppEntry = {
  useRunDetail: useInsideSalesRunDetail,
};

/* ── ResultsTabContent (extracted so it can use review context) ──── */

function ResultsTabContent({
  threads,
  filteredThreads,
  evaluated,
  failed,
  scores,
  avgScore,
  scoreBands,
  searchQuery,
  onSearchChange,
  isActive,
  runId,
}: {
  threads: ThreadEvalRow[];
  filteredThreads: ThreadEvalRow[];
  evaluated: number;
  failed: number;
  scores: number[];
  avgScore: number | null;
  scoreBands: Record<string, number>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isActive: boolean;
  runId: string;
}) {
  const navigate = useNavigate();
  const { confirmNavigation, guardModal } = useInlineReviewNavigationGuard();

  // Shared review plumbing — same hook used by kaira adversarial + batch surfaces.
  const { reviewableItems, reviewedIds, humanVerdicts } = useReviewTableData(runId, { itemType: 'call' });
  const hasAnyReviewData = !!reviewableItems || !!humanVerdicts;

  // Calls that belong to this run's active review. Navigating into a call
  // that's in this set does NOT leave the review, so the dirty-state guard
  // should not fire — edits persist in the shared reviewModeStore.
  const inScopeCallIds = useMemo(() => {
    const set = new Set<string>();
    if (!reviewableItems) return set;
    for (const itemId of reviewableItems.keys()) {
      set.add(itemId);
    }
    return set;
  }, [reviewableItems]);

  const reviewedCount = reviewedIds?.size ?? 0;

  // Human-review recompute: rebuild the score-band distribution through the
  // shared `getEffectiveAttribute` helper — same pattern as kaira adversarial.
  const reviewedScoreBands = useMemo(() => {
    if (!humanVerdicts || humanVerdicts.size === 0) return null;
    const dist: Record<string, number> = { Strong: 0, Good: 0, 'Needs work': 0, Poor: 0 };
    for (const t of threads) {
      const aiBand = getScoreBand(getOverallScore(t));
      const band = getEffectiveAttribute(humanVerdicts, t.thread_id, 'overall_verdict', aiBand) ?? aiBand;
      if (band in dist) dist[band] += 1;
    }
    return dist;
  }, [humanVerdicts, threads]);

  return (
    <div className="space-y-4 py-2">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPill
          label="Calls Evaluated"
          metricKey="calls_evaluated"
          value={`${evaluated} / ${threads.length}`}
        />
        <StatPill
          label="Avg Score"
          metricKey="avg_score"
          value={avgScore !== null ? `${avgScore} / 100` : '\u2014'}
          color={scoreColor(avgScore)}
        />
        <StatPill
          label="Failed"
          metricKey="failed_calls"
          value={String(failed)}
          color={failed > 0 ? 'var(--color-error)' : 'var(--text-muted)'}
        />
        {reviewableItems && reviewableItems.size > 0 && (
          <StatPill
            label="Reviewed"
            metricKey="reviewed_items"
            value={`${reviewedCount} / ${threads.length}`}
            color={reviewedCount > 0 ? 'var(--text-brand)' : undefined}
          />
        )}
      </div>

      {/* Distribution */}
      {scores.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <h4 className="text-[10px] font-medium text-[var(--text-muted)] uppercase">Score Bands</h4>
              {reviewedScoreBands && <span className="text-[10px] uppercase tracking-wider text-[var(--text-brand)] font-semibold">Reviewed</span>}
            </div>
            {reviewedScoreBands ? (
              <div className="space-y-2">
                <div className="opacity-60">
                  <p className="text-[10px] text-[var(--text-muted)] mb-0.5">AI</p>
                  <DistributionBar
                    distribution={scoreBands}
                    order={['Strong', 'Good', 'Needs work', 'Poor'] as const}
                  />
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-brand)] mb-0.5">Reviewed</p>
                  <DistributionBar
                    distribution={reviewedScoreBands}
                    order={['Strong', 'Good', 'Needs work', 'Poor'] as const}
                  />
                </div>
              </div>
            ) : (
              <DistributionBar
                distribution={scoreBands}
                order={['Strong', 'Good', 'Needs work', 'Poor'] as const}
              />
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search agent, lead..."
          className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
        />
      </div>

      {/* Call results table */}
      {filteredThreads.length === 0 && isActive ? (
        <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--border-default)] rounded-lg py-10 px-6">
          <Loader2 className="h-6 w-6 text-[var(--color-info)] animate-spin" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Evaluations are being processed...</p>
          <p className="text-sm text-[var(--text-secondary)]">Results will appear here as calls are evaluated.</p>
        </div>
      ) : filteredThreads.length === 0 ? (
        <EmptyState icon={Phone} title="No results" description="No evaluated calls found." compact />
      ) : (
        <div className="rounded-md border border-[var(--border-default)] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
              <tr className="border-b border-[var(--border-default)]">
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Agent &rarr; Lead</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Duration</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Score</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Band</th>
                <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Status</th>
                {hasAnyReviewData && <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Human Review</th>}
              </tr>
            </thead>
            <tbody>
              {filteredThreads.map((t) => {
                const score = getOverallScore(t);
                const meta = (t.result as unknown as Record<string, unknown>)?.call_metadata as Record<string, unknown> | undefined;
                const agent = (meta?.agent as string) || '\u2014';
                const lead = (meta?.lead as string) || '\u2014';
                const duration = (meta?.duration as number) || 0;
                const aiBand = getScoreBand(score);
                const humanBand = humanVerdicts?.get(t.thread_id)?.get('overall_verdict');
                const isReviewed = (reviewedIds?.has(t.thread_id) ?? false) || !!humanVerdicts?.get(t.thread_id);

                return (
                  <tr
                    key={t.id}
                    onClick={() => {
                      const target = `/inside-sales/runs/${runId}/calls/${t.thread_id}`;
                      if (inScopeCallIds.has(t.thread_id)) {
                        navigate(target);
                        return;
                      }
                      confirmNavigation(() => navigate(target));
                    }}
                    className="border-b border-[var(--border-subtle)] cursor-pointer hover:bg-[var(--interactive-secondary)] transition-colors"
                  >
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">
                      {agent} <span className="text-[var(--text-muted)]">&rarr;</span> {lead}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                      {duration > 0 ? formatDuration(duration) : '\u2014'}
                    </td>
                    <td className="px-3 py-2.5 font-bold" style={{ color: scoreColor(score) }}>
                      {score !== null ? score : '\u2014'}
                    </td>
                    <td className="px-3 py-2.5">
                      <VerdictBadge verdict={aiBand} category="status" humanVerdict={humanBand} />
                    </td>
                    <td className="px-3 py-2.5">
                      {t.success_status ? (
                        <span className="text-[var(--color-success)]">{'\u2713'}</span>
                      ) : (
                        <span className="text-[var(--color-error)]">{'\u2717'}</span>
                      )}
                    </td>
                    {hasAnyReviewData && (
                      <td className="px-3 py-2.5 text-[11px] font-semibold">
                        {isReviewed ? (
                          <span className="text-[var(--text-brand)]">Yes</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">No</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {guardModal}
    </div>
  );
}

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

/* ── Call Eval Detail body (review-checks + CallResultPanel) ─── */

function CallEvalDetail({
  thread,
}: {
  thread: ThreadEvalRow;
}) {
  const review = useInlineReviewOptional();
  const { guardModal } = useInlineReviewNavigationGuard();

  const reviewContextItems = review?.context?.items;
  const reviewableItem = useMemo(
    () => reviewContextItems?.find(
      (item) => item.itemType === 'call' && stripReviewItemPrefix(item.itemKey) === thread.thread_id,
    ) ?? null,
    [reviewContextItems, thread.thread_id],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {reviewableItem && reviewableItem.attributes.length > 0 && (
        <div className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Review checks</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Review the backend-defined call quality checks for this call.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-secondary)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-4 py-2 text-left font-medium text-[var(--text-secondary)]">Check</th>
                  <th className="px-4 py-2 text-left font-medium text-[var(--text-secondary)]">AI Value</th>
                  <th className="px-4 py-2 text-left font-medium text-[var(--text-secondary)]">Review</th>
                  <th className="px-4 py-2 text-left font-medium text-[var(--text-secondary)]">Source</th>
                  {review?.isEditing && <th className="px-4 py-2 text-left font-medium text-[var(--text-secondary)]">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {reviewableItem.attributes.map((attr) => {
                  const edit = review?.getEdit(reviewableItem.itemKey, attr.key);
                  const reviewValue = edit?.decision === 'correct'
                    ? edit.reviewedValue ?? '—'
                    : edit?.decision === 'accept'
                    ? 'Accepted'
                    : 'Not reviewed';
                  return (
                    <tr key={attr.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          <p className="font-medium text-[var(--text-primary)]">{attr.label}</p>
                          {attr.description && (
                            <p className="text-[11px] text-[var(--text-muted)]">{attr.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">
                        {attr.originalValue ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          <p className="font-medium text-[var(--text-primary)]">{reviewValue}</p>
                          {edit?.note && (
                            <p className="max-w-[240px] truncate text-[11px] text-[var(--text-muted)]">{edit.note}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">
                        {attr.sourceLabel ?? attr.group ?? '—'}
                      </td>
                      {review?.isEditing && (
                        <td className="px-4 py-3">
                          <InlineReviewControls
                            decision={edit?.decision}
                            note={edit?.note}
                            originalValue={attr.originalValue}
                            reviewedValue={edit?.reviewedValue}
                            allowedValues={attr.allowedValues}
                            onReject={() => review.acceptAttribute(reviewableItem, attr)}
                            onOverride={(nextValue) => review.correctAttribute(reviewableItem, attr, nextValue)}
                            onNote={(nextNote) => review.setAttributeNote(reviewableItem, attr, nextNote)}
                            onClear={() => review.clearAttribute(reviewableItem, attr)}
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
      )}

      <CallResultPanel thread={thread} />
      {guardModal}
    </div>
  );
}
