import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePoll } from "@/hooks";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Clock, ClipboardList, Ban, AlertTriangle, Cpu, Thermometer, Calendar, FileText, Trash2 } from "lucide-react";
import { EmptyState, ConfirmDialog } from "@/components/ui";
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
import { routes } from "@/config/routes";
import {
  VerdictBadge,
  MetricInfo,
  EvalTable,
  DistributionBar,
  RunProgressBar,
} from "../components";
import AdversarialTable from "../components/AdversarialTable";
import { useElapsedTime } from "../hooks";
import { CORRECTNESS_ORDER, EFFICIENCY_ORDER } from "@/utils/evalColors";
import { getLabelDefinition } from "@/config/labelDefinitions";
import { STATUS_COLORS } from "@/utils/statusColors";
import { isActiveStatus } from "@/utils/runStatus";
import { formatTimestamp, formatDuration, pct, formatMetric, normalizeLabel } from "@/utils/evalFormatters";

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

export default function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<Run | null>(null);
  const [threadEvals, setThreadEvals] = useState<ThreadEvalRow[]>([]);
  const [adversarialEvals, setAdversarialEvals] = useState<AdversarialEvalRow[]>([]);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const lastProgressRef = useRef(-1);

  const isRunActive = run != null && isActiveStatus(run.status);
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.timestamp ?? null, isRunActive);

  const summaryErrors = (run?.summary?.errors as number) ?? 0;
  const summaryCompleted = (run?.summary?.completed as number) ?? 0;
  const summaryTotal = (run?.summary?.total_threads as number) ?? 0;
  const summarySkipped = (run?.summary?.skipped_previously_processed as number) ?? 0;

  const handleDeleteConfirm = useCallback(async () => {
    if (!runId || !run) return;
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await deleteRun(runId);
      navigate(routes.kaira.runs, { replace: true });
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Unknown error', "Delete failed");
      setDeleting(false);
    }
  }, [runId, run, navigate]);

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
    enabled: !!runStatus && isActiveStatus(runStatus) && !!runJobId,
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
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <XCircle className="h-10 w-10 text-[var(--text-muted)]" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Run not found</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          This evaluation run may have been deleted or doesn't exist.
        </p>
        <Link to={routes.kaira.runs} className="text-sm font-medium text-[var(--text-brand)] hover:underline">
          Back to runs
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <AlertTriangle className="h-10 w-10 text-[var(--color-error)]" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Failed to load run</h2>
        <p className="text-sm text-[var(--color-error)]">{error}</p>
        <Link to={routes.kaira.runs} className="text-sm font-medium text-[var(--text-brand)] hover:underline">
          Back to runs
        </Link>
      </div>
    );
  }

  if (!run) {
    return <div className="text-sm text-[var(--text-muted)] text-center py-8">Loading...</div>;
  }

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

  return (
    <div className="flex flex-col h-[calc(100vh-var(--header-height,48px))]">
      {/* ── Sticky header ─────────────────────────────────── */}
      <div className="shrink-0 space-y-2 pb-2">
        <nav className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Link to={routes.kaira.runs} className="hover:text-[var(--text-brand)] transition-colors">Runs</Link>
          <span>/</span>
          <span className="font-mono text-[var(--text-primary)] font-medium">{run.run_id.slice(0, 12)}</span>
        </nav>

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

        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-[13px] font-bold text-[var(--text-primary)] truncate">
              {run.name || run.command}
            </h1>
            <VerdictBadge verdict={run.status} category="status" />
            {run.description && (
              <span className="text-xs text-[var(--text-secondary)] truncate hidden sm:inline">{run.description}</span>
            )}
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <Link
                to={`${routes.kaira.logs}?run_id=${run.run_id}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <FileText className="h-3 w-3" />
                Logs
              </Link>
              {isRunActive && activeJob && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[var(--color-warning)] bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                >
                  <Ban className="h-3 w-3" />
                  {cancelling ? "Cancelling\u2026" : "Cancel"}
                </button>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleting || isRunActive}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[var(--color-error)] bg-[var(--surface-error)] border border-[var(--border-error)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                title={isRunActive ? "Cannot delete a running evaluation. Cancel it first." : undefined}
              >
                <Trash2 className="h-3 w-3" />
                {deleting ? "Deleting\u2026" : "Delete"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1 text-xs text-[var(--text-muted)]">
            <span className="font-mono">{run.run_id.slice(0, 12)}</span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatTimestamp(run.timestamp)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {isRunActive ? elapsed || "\u2014" : formatDuration(run.duration_seconds)}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {run.llm_provider}/{run.llm_model}
            </span>
            <span className="flex items-center gap-1">
              <Thermometer className="h-3 w-3" />
              {run.eval_temperature}
            </span>
            {run.data_path && (
              <span className="flex items-center gap-1 truncate max-w-48">
                <FileText className="h-3 w-3 shrink-0" />
                {run.data_path}
              </span>
            )}
            {run.error_message && (
              <span className="text-[var(--color-error)]">{run.error_message}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-1">
        {threadEvals.length > 0 && (
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
                    value={d.aggregation?.average != null
                      ? formatMetric(d.aggregation.average, d.primaryField?.format)
                      : (() => {
                        const valid = threadEvals.filter(e => e.intent_accuracy != null);
                        return valid.length > 0 ? pct(valid.reduce((s, e) => s + e.intent_accuracy!, 0) / valid.length) : 'N/A';
                      })()}
                  />
                ))}
              {!(run.evaluator_descriptors?.length) && (() => {
                const incompleteCount = threadEvals.filter((e) => normalizeLabel(e.efficiency_verdict ?? '') === 'INCOMPLETE').length;
                const evaluable = threadEvals.length - incompleteCount;
                const completedCount = threadEvals.filter((e) => e.success_status).length;
                return (
                  <>
                    <StatPill label="Avg Judge Intent Acc" metricKey="avg_intent_acc" value={(() => {
                      const valid = threadEvals.filter(e => e.intent_accuracy != null);
                      return valid.length > 0 ? pct(valid.reduce((s, e) => s + e.intent_accuracy!, 0) / valid.length) : 'N/A';
                    })()} />
                    <StatPill label="Completion Rate" metricKey="completion_rate" value={evaluable > 0 ? pct(completedCount / evaluable) : 'N/A'} />
                    {incompleteCount > 0 && <StatPill label="Incomplete" value={incompleteCount} color="var(--text-muted)" />}
                  </>
                );
              })()}
              {summaryErrors > 0 ? (
                <StatPill label="Errors" value={`${summaryErrors} / ${summaryTotal}`} color="var(--color-error)" />
              ) : (() => {
                const incompleteCount = threadEvals.filter((e) => normalizeLabel(e.efficiency_verdict ?? '') === 'INCOMPLETE').length;
                const evaluable = threadEvals.length - incompleteCount;
                const completedCount = threadEvals.filter((e) => e.success_status).length;
                return <StatPill label="Completed" metricKey="completed" value={`${completedCount} / ${evaluable}`} />;
              })()}
            </div>

            <div className="flex gap-4 flex-wrap">
              {run.evaluator_descriptors
                ? run.evaluator_descriptors
                  .filter(d => d.type === 'built-in' && d.primaryField?.format === 'verdict' && d.aggregation?.distribution && Object.keys(d.aggregation.distribution).length > 0)
                  .map(d => (
                    <div key={d.id} className="flex-1 min-w-[260px]">
                      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">{d.name}</h3>
                      <DistributionBar distribution={d.aggregation!.distribution!} order={d.primaryField!.verdictOrder} />
                    </div>
                  ))
                : (
                  <>
                    {Object.keys(correctnessDist).length > 0 && (
                      <div className="flex-1 min-w-[260px]">
                        <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Correctness</h3>
                        <DistributionBar distribution={correctnessDist} order={CORRECTNESS_ORDER} />
                      </div>
                    )}
                    {Object.keys(efficiencyDist).length > 0 && (
                      <div className="flex-1 min-w-[260px]">
                        <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Efficiency</h3>
                        <DistributionBar distribution={efficiencyDist} order={EFFICIENCY_ORDER} />
                      </div>
                    )}
                  </>
                )}
            </div>

            {customEvalSummary.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Custom Evaluators</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                  {customEvalSummary.map(({ id, name, completed, errors, distribution, average }) => (
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
                        <div className="mt-1.5"><DistributionBar distribution={distribution} /></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search thread ID, verdict..."
                className="px-2.5 py-1.5 text-sm border border-[var(--border-default)] rounded-md w-60 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30 focus:border-[var(--border-focus)]"
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

            <EvalTable evaluations={filteredThreads} evaluatorDescriptors={run.evaluator_descriptors} />
          </>
        )}

        {adversarialEvals.length > 0 && <AdversarialSection evals={adversarialEvals} adversarialDist={adversarialDist} runId={run.run_id} isRunActive={isRunActive} />}

        {threadEvals.length === 0 && adversarialEvals.length === 0 && (
          isRunActive ? (
            <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--border-default)] rounded-lg py-10 px-6">
              <Loader2 className="h-6 w-6 text-[var(--color-info)] animate-spin" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Evaluations are being processed...</p>
              <p className="text-sm text-[var(--text-secondary)]">Results will appear here as threads are evaluated.</p>
            </div>
          ) : (
            <EmptyState icon={ClipboardList} title="No evaluations found" description="This run has no evaluation results yet." />
          )
        )}
      </div>

      {run && (
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
      )}
    </div>
  );
}

function AdversarialSection({ evals, adversarialDist, runId, isRunActive }: {
  evals: AdversarialEvalRow[];
  adversarialDist: Record<string, number>;
  runId: string;
  isRunActive: boolean;
}) {
  const failedCount = evals.filter((e) => e.verdict == null).length;
  const successfulEvals = evals.filter((e) => e.verdict != null);
  const successfulCount = successfulEvals.length;

  return (
    <>
      {failedCount > 0 && !isRunActive && <AdversarialErrorBanner errors={failedCount} total={evals.length} />}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill label="Tests" metricKey="total_tests" value={evals.length} />
        <StatPill label="Pass Rate" metricKey="pass_rate" value={successfulCount > 0 ? pct(successfulEvals.filter((e) => normalizeLabel(e.verdict!) === "PASS").length / successfulCount) : "N/A"} />
        <StatPill label="Goal Achievement" metricKey="goal_achievement" value={successfulCount > 0 ? pct(successfulEvals.filter((e) => e.goal_achieved).length / successfulCount) : "N/A"} />
        {failedCount > 0 ? (
          <StatPill label="Errors" value={`${failedCount} / ${evals.length}`} color="var(--color-error)" />
        ) : (
          <StatPill label="Avg Turns" metricKey="avg_turns" value={(evals.reduce((s, e) => s + e.total_turns, 0) / evals.length).toFixed(1)} />
        )}
      </div>

      {Object.keys(adversarialDist).length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">Verdicts</h3>
          <DistributionBar distribution={adversarialDist} />
        </div>
      )}

      <AdversarialTable evaluations={evals} runId={runId} />
    </>
  );
}

function StatPill({ label, value, metricKey, color }: { label: string; value: string | number; metricKey?: string; color?: string }) {
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2">
      <div className="flex items-center gap-1">
        <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</p>
        {metricKey && <MetricInfo metricKey={metricKey} />}
      </div>
      <p className={`text-lg font-bold mt-0.5 leading-tight${color ? "" : " text-[var(--text-primary)]"}`} style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}
