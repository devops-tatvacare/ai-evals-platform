import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Phone,
  Search,
  ClipboardCheck,
  Lock,
} from 'lucide-react';
import { Button, Tabs, EmptyState } from '@/components/ui';
import { EvalRunVisibilityPanel } from '@/features/evalRuns/components';
import VerdictBadge from '@/features/evalRuns/components/VerdictBadge';
import { RunProgressBar } from '@/features/evalRuns/components/RunProgressBar';
import { RunHeaderActions } from '@/features/evalRuns/components/RunHeaderActions';
import { useElapsedTime } from '@/features/evalRuns/hooks';
import DistributionBar from '@/features/evalRuns/components/DistributionBar';
import {
  InlineReviewProvider, useInlineReviewOptional,
  InlineReviewBadge, InlineReviewControls, DirtyBar, VerdictChip, VerdictDropdown, useInlineReviewNavigationGuard,
  useReviewOverrides,
} from '@/features/reviews/inline';
import { useRunReviewMeta } from '@/features/reviews/reviewOverridesStore';
import { ReviewLockTooltip } from '@/features/reviews/ReviewLockTooltip';
import { fetchEvalRun, fetchRunThreads, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { usePoll } from '@/hooks';
import { routes } from '@/config/routes';
import { formatDuration } from '@/utils/formatters';
import { timeAgo } from '@/utils/evalFormatters';
import { isActiveStatus } from '@/utils/runStatus';
import { scoreColor, getScoreBand } from '@/utils/scoreUtils';
import { CallResultPanel } from '../components/CallResultPanel';
import type { EvalRun, ThreadEvalRow, ReviewableItem, ReviewableAttribute } from '@/types';
import type { Job } from '@/services/api/jobsApi';
import { AppReportTab } from '@/features/analytics/AppReportTab';
import { usePermission } from '@/utils/permissions';
import { useReviewModeStore } from '@/stores/reviewModeStore';

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

export function InsideSalesRunDetail() {
  const { runId, callId } = useParams<{ runId: string; callId?: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<EvalRun | null>(null);
  const [threads, setThreads] = useState<ThreadEvalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const canReview = usePermission('review:manage');

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="space-y-3">
        <Link to={routes.insideSales.runs} className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-brand)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Runs
        </Link>
        <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error || 'Run not found'}
        </div>
      </div>
    );
  }

  // Compute stats from threads
  const evaluated = threads.filter((t) => t.success_status).length;
  const failed = threads.length - evaluated;
  const scores = threads.map(getOverallScore).filter((s): s is number => s !== null);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  const scoreBands: Record<string, number> = { Strong: 0, Good: 0, 'Needs work': 0, Poor: 0 };
  scores.forEach((s) => { scoreBands[getScoreBand(s)]++; });

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
      <AppReportTab appId="inside-sales" runId={runId!} />
    ),
  };

  // If callId is present, show call eval detail instead of run overview
  const selectedThread = callId ? threads.find((t) => t.thread_id === callId) : null;

  if (callId && selectedThread) {
    return (
      <InlineReviewProvider runId={runId!} appId="inside-sales" enabled={canReview}>
        <CallEvalDetail run={run} thread={selectedThread} siblings={threads} />
      </InlineReviewProvider>
    );
  }

  return (
    <InlineReviewProvider runId={runId!} appId="inside-sales" enabled={canReview}>
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
          <Link to={routes.insideSales.runs} className="hover:text-[var(--text-brand)]">Runs</Link>
          <span>/</span>
          <span className="font-mono text-[var(--text-secondary)]">{run.id.slice(0, 12)}</span>
        </div>

        {/* Header */}
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-bold text-[var(--text-primary)] truncate">{getRunName(run)}</h1>
            <VerdictBadge verdict={run.status} category="status" />
            <RunHeaderActions
              logsHref={`${routes.insideSales.logs}?run_id=${run.id}`}
              isActive={isActive}
              cancelling={cancelling}
              deleting={isDeleting}
              onCancel={handleCancel}
              onDelete={handleDelete}
              visibilityContent={(
                <EvalRunVisibilityPanel
                  runId={run.id}
                  visibility={run.visibility ?? 'private'}
                  ownerId={run.userId}
                  mode="inline"
                  onUpdated={(visibility) => setRun((current) => (current ? { ...current, visibility } : current))}
                />
              )}
            />
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--text-muted)]">
            <span className="font-mono">{run.id.slice(0, 8)}</span>
            {run.startedAt && <span>{timeAgo(run.startedAt)}</span>}
            {run.durationMs && <span>{formatDuration(Math.round(run.durationMs / 1000))}</span>}
            {run.llmModel && <span>{run.llmModel}</span>}
          </div>
        </div>

        {/* Start Review button */}
        <StartReviewButton runId={run.id} />

        {/* Progress bar */}
        {isActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}

        {/* Tabs */}
        <ReviewAwareTabs tabs={[resultsTab, reportTab]} defaultTab="results" />

        {/* Dirty bar for unsaved review changes */}
        <ReviewDirtyBar />
        <ReviewLinkGuard />
      </div>
    </InlineReviewProvider>
  );
}

/* ── StatCard ────────────────────────────────────────────── */

function StatCard({ label, value, color, beforeValue }: { label: string; value: string; color?: string; beforeValue?: string }) {
  const showDelta = beforeValue != null && beforeValue !== value;
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5">
      <div className="text-[10px] font-medium text-[var(--text-muted)] uppercase">{label}</div>
      {showDelta ? (
        <div className="text-lg font-bold mt-0.5 flex items-baseline gap-1">
          <span className="text-sm text-[var(--text-muted)] line-through">{beforeValue}</span>
          <span className="text-xs text-[var(--text-muted)]">&rarr;</span>
          <span style={{ color: color || 'var(--text-primary)' }}>{value}</span>
        </div>
      ) : (
        <div className="text-lg font-bold mt-0.5" style={{ color: color || 'var(--text-primary)' }}>
          {value}
        </div>
      )}
    </div>
  );
}

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
  const review = useInlineReviewOptional();
  const isEditing = review?.isEditing ?? false;
  const { getOverride } = useReviewOverrides(runId);
  const { confirmNavigation, guardModal } = useInlineReviewNavigationGuard();

  // Calls that belong to this run's active review. Navigating into a call
  // that's in this set does NOT leave the review, so the dirty-state guard
  // should not fire — edits persist in the shared reviewModeStore.
  const reviewContextItems = review?.context?.items;
  const inScopeCallIds = useMemo(() => {
    const set = new Set<string>();
    if (!reviewContextItems) return set;
    for (const item of reviewContextItems) {
      if (item.itemType !== 'call') continue;
      const raw = item.itemKey.includes(':')
        ? item.itemKey.split(':').slice(1).join(':')
        : item.itemKey;
      set.add(raw);
    }
    return set;
  }, [reviewContextItems]);

  // Compute human-adjusted stats from review overrides
  const adjusted = useMemo(() => {
    if (!review || !threads.length) return null;

    const adjScores: number[] = [];
    const adjBands: Record<string, number> = { Strong: 0, Good: 0, 'Needs work': 0, Poor: 0 };
    let anyChange = false;

    for (const t of threads) {
      const aiScore = getOverallScore(t);
      if (aiScore === null) continue;

      const edit = review.getEdit(`call:${t.thread_id}`, 'overall_verdict');
      const hasOverride = edit?.decision === 'correct' && edit.reviewedValue != null;

      if (hasOverride) {
        anyChange = true;
        const band = edit.reviewedValue!;
        adjBands[band] = (adjBands[band] ?? 0) + 1;
        adjScores.push(aiScore); // score itself doesn't change, only band
      } else {
        const band = getScoreBand(aiScore);
        adjBands[band] = (adjBands[band] ?? 0) + 1;
        adjScores.push(aiScore);
      }
    }

    if (!anyChange) return null;

    const adjAvg = adjScores.length > 0
      ? Math.round(adjScores.reduce((a, b) => a + b, 0) / adjScores.length)
      : null;

    return { avgScore: adjAvg, bands: adjBands };
  }, [review, threads]);

  const distChanged = adjusted && JSON.stringify(adjusted.bands) !== JSON.stringify(scoreBands);

  // Count reviewed items
  const reviewedCount = useMemo(() => {
    if (!review) return 0;
    return Object.values(review.edits).filter((e) => e.decision !== '').length;
  }, [review]);

  return (
    <div className="space-y-4 py-2">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Calls Evaluated" value={`${evaluated} / ${threads.length}`} />
        <StatCard
          label="Avg Score"
          value={avgScore !== null ? `${avgScore} / 100` : '\u2014'}
          color={scoreColor(avgScore)}
        />
        <StatCard
          label="Failed"
          value={String(failed)}
          color={failed > 0 ? 'var(--color-error)' : 'var(--text-muted)'}
        />
        {review && threads.length > 0 && (
          <StatCard
            label="Reviewed"
            value={`${reviewedCount} / ${threads.length}`}
            color={reviewedCount > 0 ? 'var(--color-success)' : undefined}
          />
        )}
      </div>

      {/* Distribution */}
      {scores.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <h4 className="text-[10px] font-medium text-[var(--text-muted)] uppercase mb-1.5">Score Bands</h4>
            <DistributionBar
              distribution={distChanged ? adjusted!.bands : scoreBands}
              aiDistribution={distChanged ? scoreBands : undefined}
              order={['Strong', 'Good', 'Needs work', 'Poor'] as const}
            />
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
                {review && <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Review</th>}
                {isEditing && <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredThreads.map((t) => {
                const score = getOverallScore(t);
                const meta = (t.result as unknown as Record<string, unknown>)?.call_metadata as Record<string, unknown> | undefined;
                const agent = (meta?.agent as string) || '\u2014';
                const lead = (meta?.lead as string) || '\u2014';
                const duration = (meta?.duration as number) || 0;
                const band = getScoreBand(score);

                const itemKey = `call:${t.thread_id}`;
                const edit = review?.getEdit(itemKey, 'overall_verdict');
                const override = getOverride(itemKey, 'overall_verdict');
                const item: ReviewableItem = {
                  itemKey, itemType: 'call', title: `${agent} \u2192 ${lead}`,
                  subtitle: null, badges: [], evidence: [], attributes: [],
                };
                const attr: ReviewableAttribute = {
                  key: 'overall_verdict', label: 'Overall Band',
                  originalValue: band,
                  allowedValues: ['Strong', 'Good', 'Needs work', 'Poor'],
                };

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
                      <VerdictChip
                        aiVerdict={band}
                        humanVerdict={override?.reviewedValue}
                        category="status"
                        renderBadge={(v) => <VerdictBadge verdict={v ?? band} category="status" />}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      {t.success_status ? (
                        <span className="text-[var(--color-success)]">{'\u2713'}</span>
                      ) : (
                        <span className="text-[var(--color-error)]">{'\u2717'}</span>
                      )}
                    </td>
                    {review && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <InlineReviewBadge
                          decision={edit?.decision}
                          isDraft={review.selectedReview?.status === 'draft'}
                        />
                      </td>
                    )}
                    {isEditing && review && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <InlineReviewControls
                          decision={edit?.decision}
                          note={edit?.note}
                          originalValue={band}
                          reviewedValue={edit?.reviewedValue}
                          allowedValues={attr.allowedValues}
                          onReject={() => review.acceptAttribute(item, attr)}
                          onOverride={(nextValue) => review.correctAttribute(item, attr, nextValue)}
                          onNote={(nextNote) => review.setAttributeNote(item, attr, nextNote)}
                          onClear={() => review.clearAttribute(item, attr)}
                        />
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

/* ── Inline Review Helpers ───────────────────────────────── */

function StartReviewButton({ runId }: { runId: string }) {
  const review = useInlineReviewOptional();
  const { activeDraft } = useRunReviewMeta(runId);
  if (!review || review.isEditing || review.loading) return null;
  const lockedByOther = !!activeDraft && !activeDraft.isMine;

  const button = (
    <Button
      variant="secondary"
      size="sm"
      icon={lockedByOther ? Lock : ClipboardCheck}
      onClick={lockedByOther ? undefined : review.startDraft}
      isLoading={review.saving}
      disabled={lockedByOther}
    >
      {lockedByOther ? 'Review in progress' : review.selectedReview ? 'Continue Review' : 'Start Review'}
    </Button>
  );
  return (
    <div className="flex justify-end">
      {lockedByOther && activeDraft ? (
        <ReviewLockTooltip activeDraft={activeDraft}>{button}</ReviewLockTooltip>
      ) : (
        button
      )}
    </div>
  );
}

function ReviewDirtyBar() {
  const review = useInlineReviewOptional();
  if (!review) return null;

  return (
    <DirtyBar
      isEditing={review.isEditing}
      changeCount={review.dirtyCount}
      changeSummary={review.dirtySummary}
      saving={review.saving}
      onDiscard={review.discardDraft}
      onSaveDraft={review.saveDraft}
      onFinalize={review.finalize}
    />
  );
}

function ReviewAwareTabs(props: Parameters<typeof Tabs>[0]) {
  const { confirmNavigation, guardModal } = useInlineReviewNavigationGuard();

  return (
    <>
      <Tabs
        {...props}
        beforeChange={(_tabId, commit) => {
          confirmNavigation(commit);
        }}
      />
      {guardModal}
    </>
  );
}

function ReviewLinkGuard() {
  const { guardModal } = useInlineReviewNavigationGuard({ captureLinks: true });
  return guardModal;
}

/* ── Call Eval Detail (split-pane, mirrors ThreadDetailV2 layout) ── */

function CallEvalDetail({
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
  const { confirmNavigation, guardModal } = useInlineReviewNavigationGuard();

  // Calls in this run's review context — same-scope navigation does not
  // need the dirty-state guard (edits persist in the shared store).
  const reviewContextItems = review?.context?.items;
  const inScopeCallIds = useMemo(() => {
    const set = new Set<string>();
    if (!reviewContextItems) return set;
    for (const item of reviewContextItems) {
      if (item.itemType !== 'call') continue;
      const raw = item.itemKey.includes(':')
        ? item.itemKey.split(':').slice(1).join(':')
        : item.itemKey;
      set.add(raw);
    }
    return set;
  }, [reviewContextItems]);

  const result = thread.result as unknown as Record<string, unknown> | undefined;
  const meta = result?.call_metadata as Record<string, unknown> | undefined;
  const evals = result?.evaluations as Array<Record<string, unknown>> | undefined;
  const evalOutput = evals?.[0]?.output as Record<string, unknown> | undefined;
  const overallScore = getOverallScore(thread);

  // Compliance gates (boolean fields)
  const complianceGates = evalOutput
    ? Object.entries(evalOutput).filter(([, v]) => typeof v === 'boolean')
    : [];

  const allPassed = complianceGates.every(([, v]) => v === true);

  // Thread navigation
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
  const verdictItem: ReviewableItem = {
    itemKey: `call:${thread.thread_id}`,
    itemType: 'call',
    title: thread.thread_id,
    subtitle: null,
    badges: [],
    evidence: [],
    attributes: [],
  };
  const verdictAttribute: ReviewableAttribute = {
    key: 'overall_verdict',
    label: 'Overall Band',
    originalValue: getScoreBand(overallScore),
    allowedValues: ['Strong', 'Good', 'Needs work', 'Poor'],
  };
  const verdictEdit = review?.getEdit(verdictItem.itemKey, verdictAttribute.key);
  const verdictValue = verdictEdit?.decision === 'correct' && verdictEdit.reviewedValue != null
    ? verdictEdit.reviewedValue
    : verdictAttribute.originalValue;
  const canEditVerdict = !!review?.isEditing;
  const isVerdictSaved = useReviewModeStore((s) => s.isAttributeSaved(verdictItem.itemKey, verdictAttribute.key));

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="shrink-0 pb-3 space-y-2">
        {/* Row 1: breadcrumb + thread nav */}
        <div className="flex items-center justify-between gap-4">
          <nav className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] min-w-0">
            <Link to={routes.insideSales.runs} className="hover:text-[var(--text-brand)] shrink-0">Runs</Link>
            <span>/</span>
              <button
                onClick={() => navigate(routes.insideSales.runDetail(run.id))}
                className="hover:text-[var(--text-brand)] font-mono shrink-0"
              >
              {run.id.slice(0, 12)}
            </button>
            <span>/</span>
            <span className="font-mono text-[var(--text-primary)] font-medium truncate">
              {(meta?.agent as string) || '—'} → {(meta?.lead as string) || '—'}
            </span>
          </nav>

          {/* Thread navigation */}
          {siblings.length > 1 && (
            <span className="inline-flex items-center gap-0.5 border border-[var(--border-subtle)] rounded-md bg-[var(--bg-secondary)] shrink-0">
              <button
                disabled={!prevThread}
                onClick={() => prevThread && goToThread(prevThread.thread_id)}
                className="p-1 disabled:opacity-30 hover:bg-[var(--interactive-secondary)] rounded-l-md transition-colors cursor-pointer disabled:cursor-default"
              >
                <ArrowLeft size={14} />
              </button>
              <span className="text-[10px] tabular-nums px-1 border-x border-[var(--border-subtle)]">
                {currentIdx + 1}/{siblings.length}
              </span>
              <button
                disabled={!nextThread}
                onClick={() => nextThread && goToThread(nextThread.thread_id)}
                className="p-1 disabled:opacity-30 hover:bg-[var(--interactive-secondary)] rounded-r-md transition-colors cursor-pointer disabled:cursor-default"
              >
                <ArrowLeft size={14} className="rotate-180" />
              </button>
            </span>
          )}
        </div>

        {/* Row 2: summary bar */}
        <div className="overflow-x-auto scrollbar-thin">
          <div className="w-fit mx-auto">
            <div className="inline-flex items-stretch rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-sm">
              <SummaryPill label="Score" value={overallScore !== null ? `${overallScore}/100` : '—'} color={scoreColor(overallScore)} />
              <SummaryPill
                label="Verdict"
                value={(
                  <div className="flex flex-col items-center gap-1">
                    <VerdictDropdown
                      originalValue={verdictAttribute.originalValue}
                      value={verdictValue}
                      allowedValues={verdictAttribute.allowedValues}
                      isEditing={canEditVerdict}
                      isSaved={isVerdictSaved}
                      color={scoreColor(overallScore)}
                      onChange={(nextValue) => review?.correctAttribute(verdictItem, verdictAttribute, nextValue)}
                    />
                    {canEditVerdict && review && (
                      <InlineReviewControls
                        decision={verdictEdit?.decision}
                        note={verdictEdit?.note}
                        originalValue={verdictAttribute.originalValue}
                        reviewedValue={verdictEdit?.reviewedValue}
                        allowedValues={verdictAttribute.allowedValues}
                        onReject={() => review.acceptAttribute(verdictItem, verdictAttribute)}
                        onOverride={(nextValue) => review.correctAttribute(verdictItem, verdictAttribute, nextValue)}
                        onNote={(nextNote) => review.setAttributeNote(verdictItem, verdictAttribute, nextNote)}
                        onClear={() => review.clearAttribute(verdictItem, verdictAttribute)}
                      />
                    )}
                  </div>
                )}
              />
              <SummaryPill
                label="Compliance"
                value={complianceGates.length > 0 ? (allPassed ? 'Pass' : 'Fail') : '—'}
                color={complianceGates.length > 0 ? (allPassed ? 'var(--color-success)' : 'var(--color-error)') : undefined}
              />
              <SummaryPill label="Agent" value={(meta?.agent as string) || '—'} />
              <SummaryPill label="Duration" value={typeof meta?.duration === 'number' ? formatDuration(meta.duration) : '—'} />
            </div>
          </div>
        </div>
      </div>

      <CallResultPanel thread={thread} />
      {guardModal}
    </div>
  );
}

/* ── Summary Pill ───────────────────────────────────────── */

function SummaryPill({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-2 border-l border-[var(--border-subtle)] first:border-l-0">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] leading-none">{label}</span>
      <span className="leading-none font-semibold text-sm" style={typeof value === 'string' ? { color: color || 'var(--text-primary)' } : undefined}>{value}</span>
    </div>
  );
}
