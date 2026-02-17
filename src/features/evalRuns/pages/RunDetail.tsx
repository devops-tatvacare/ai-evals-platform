import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Clock, Search, ClipboardList, Ban, AlertTriangle, Cpu, Thermometer, Calendar, FileText } from "lucide-react";
import { EmptyState, ConfirmDialog } from "@/components/ui";
import type { Run, ThreadEvalRow, AdversarialEvalRow, CustomEvaluationResult } from "@/types";
import {
  fetchRun,
  fetchRunThreads,
  fetchRunAdversarial,
  deleteRun,
} from "@/services/api/evalRunsApi";
import { jobsApi, type Job } from "@/services/api/jobsApi";
import {
  VerdictBadge,
  MetricInfo,
  EvalTable,
  DistributionBar,
  RuleComplianceGrid,
  EvalSection,
  EvalCard,
  EvalCardHeader,
  EvalCardBody,
} from "../components";
import { ChatViewer } from "../components/TranscriptViewer";
import { CORRECTNESS_ORDER, EFFICIENCY_ORDER, CATEGORY_COLORS } from "@/utils/evalColors";
import { getVerdictColor, getLabelDefinition } from "@/config/labelDefinitions";
import { STATUS_COLORS } from "@/utils/statusColors";
import { formatTimestamp, formatDuration, humanize, pct, normalizeLabel, unwrapSerializedDates } from "@/utils/evalFormatters";

function computeElapsed(startedAt: string): string {
  const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (secs < 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function useElapsedTime(startedAt: string | null, active: boolean): string {
  const [elapsed, setElapsed] = useState(() =>
    startedAt && active ? computeElapsed(startedAt) : "",
  );
  useEffect(() => {
    if (!startedAt || !active) return;
    const id = setInterval(() => {
      setElapsed(computeElapsed(startedAt));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, active]);
  return startedAt && active ? elapsed : "";
}

interface ProgressState {
  current: number;
  total: number;
  message: string;
}

function RunProgressBar({
  job,
  elapsed,
}: {
  job: Job | null;
  elapsed: string;
}) {
  if (!job) return null;

  const isQueued = job.status === "queued";
  const isRunning = job.status === "running";
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";

  const progress = job.progress as ProgressState | undefined;
  const pctValue =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  if (isCompleted || isFailed || isCancelled) return null;

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isQueued && (
            <>
              <Clock className="h-4 w-4 text-[var(--color-warning)] animate-pulse" />
              <span className="text-sm font-semibold text-[var(--color-warning)]">
                Queued
              </span>
            </>
          )}
          {isRunning && (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-info)] opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-info)]" />
              </span>
              <span className="text-sm font-semibold text-[var(--color-info)]">
                Running
              </span>
            </>
          )}
          {progress?.message && (
            <span className="text-sm text-[var(--text-secondary)]">
              {progress.message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          {elapsed && <span>{elapsed} elapsed</span>}
          {isRunning && progress && progress.total > 0 && (
            <span>{progress.current}/{progress.total}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        {isQueued && (
          <div className="h-full bg-[var(--color-warning)] rounded-full w-full animate-pulse opacity-30" />
        )}
        {isRunning && progress && progress.total > 0 && (
          <div
            className="h-full bg-[var(--color-info)] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pctValue}%` }}
          />
        )}
        {isRunning && (!progress || progress.total === 0) && (
          <div className="h-full bg-[var(--color-info)] rounded-full w-full animate-pulse opacity-40" />
        )}
      </div>

      {isQueued && (
        <p className="text-xs text-[var(--text-muted)]">
          Waiting for worker to pick up this job...
        </p>
      )}
    </div>
  );
}

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
  const [view, setView] = useState<"table" | "detail">("table");
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Live progress polling state
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const pollingRef = useRef(false);

  const isRunActive = run != null && run.status.toLowerCase() === "running";
  const elapsed = useElapsedTime(activeJob?.startedAt ?? run?.timestamp ?? null, isRunActive);

  const summaryErrors = (run?.summary?.errors as number) ?? 0;
  const summaryCompleted = (run?.summary?.completed as number) ?? 0;
  const summaryTotal = (run?.summary?.total_threads as number) ?? 0;

  const handleDeleteConfirm = useCallback(async () => {
    if (!runId || !run) return;
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await deleteRun(runId);
      navigate("/kaira/runs", { replace: true });
    } catch (e: any) {
      setError(e.message);
      setDeleting(false);
    }
  }, [runId, run, navigate]);

  const handleCancel = useCallback(async () => {
    if (!activeJob) return;
    setCancelling(true);
    try {
      await jobsApi.cancel(activeJob.id);
    } catch (e: any) {
      setError(e.message);
      setCancelling(false);
    }
  }, [activeJob]);

  // Initial data load
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
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => { cancelled = true; };
  }, [runId]);

  // Poll job progress when run is active
  const runJobId = run?.job_id ?? null;
  const runStatus = run?.status ?? null;
  useEffect(() => {
    if (!runJobId || !runStatus || runStatus.toLowerCase() !== "running") return;
    if (pollingRef.current) return;
    pollingRef.current = true;

    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const job = await jobsApi.get(runJobId!);
          if (cancelled) break;
          setActiveJob(job);

          if (["completed", "failed", "cancelled"].includes(job.status)) {
            // Re-fetch the full run data to get updated status, summary, evaluations
            if (runId) {
              try {
                const [r, t, a] = await Promise.all([
                  fetchRun(runId),
                  fetchRunThreads(runId).catch(() => ({ evaluations: [] as ThreadEvalRow[] })),
                  fetchRunAdversarial(runId).catch(() => ({ evaluations: [] as AdversarialEvalRow[] })),
                ]);
                if (!cancelled) {
                  setRun(r);
                  setThreadEvals(t.evaluations);
                  setAdversarialEvals(a.evaluations);
                }
              } catch {
                // Run data refresh failed, still stop polling
              }
            }
            if (job.status === "completed" && !cancelled) {
              setShowSuccessBanner(true);
              setTimeout(() => setShowSuccessBanner(false), 8000);
            }
            break;
          }
        } catch {
          // Polling error — wait and retry
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      pollingRef.current = false;
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [runJobId, runStatus, runId]);

  const allVerdicts = useMemo(() => {
    const set = new Set<string>();
    for (const te of threadEvals) {
      if (te.worst_correctness) set.add(normalizeLabel(te.worst_correctness));
      if (te.efficiency_verdict) set.add(normalizeLabel(te.efficiency_verdict));
    }
    return Array.from(set);
  }, [threadEvals]);

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
        const verdicts = [te.worst_correctness, te.efficiency_verdict]
          .filter(Boolean)
          .map((v) => normalizeLabel(v!));
        if (!verdicts.some((v) => verdictFilter.has(v))) return false;
      }
      return true;
    });
  }, [threadEvals, search, verdictFilter]);

  const customEvalSummary = useMemo(() => {
    const raw = (run?.summary?.custom_evaluations ?? {}) as Record<string, { name: string; completed: number; errors: number }>;
    return Object.entries(raw).map(([id, v]) => ({ id, ...v }));
  }, [run?.summary]);

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        {error}
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
  const categoryDist: Record<string, number> = {};
  for (const ae of adversarialEvals) {
    if (ae.verdict != null) {
      const n = normalizeLabel(ae.verdict);
      adversarialDist[n] = (adversarialDist[n] ?? 0) + 1;
    }
    categoryDist[ae.category] = (categoryDist[ae.category] ?? 0) + 1;
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
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
        <Link to="/kaira/runs" className="hover:text-[var(--text-brand)]">Runs</Link>
        <span>/</span>
        <span className="font-mono text-[var(--text-secondary)]">{run.run_id.slice(0, 12)}</span>
      </div>

      {/* Live progress bar for running/queued jobs */}
      {isRunActive && <RunProgressBar job={activeJob} elapsed={elapsed} />}

      {/* Success/failure/cancelled/partial banners */}
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
              to={`/kaira/logs?run_id=${run.run_id}`}
              className="px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              Logs
            </Link>
            {isRunActive && activeJob && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-2 py-0.5 text-xs font-medium text-[var(--color-warning)] bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || isRunActive}
              className="px-2 py-0.5 text-xs font-medium text-[var(--color-error)] bg-[var(--surface-error)] border border-[var(--border-error)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              title={isRunActive ? "Cannot delete a running evaluation. Cancel it first." : undefined}
            >
              {deleting ? "Deleting…" : "Delete"}
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
            {isRunActive ? elapsed || "—" : formatDuration(run.duration_seconds)}
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

      {threadEvals.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill
              label="Threads"
              metricKey="total_threads"
              value={summaryTotal > 0 ? `${threadEvals.length} / ${summaryTotal}` : threadEvals.length}
            />
            <StatPill
              label="Avg Intent Acc"
              metricKey="avg_intent_acc"
              value={pct(
                threadEvals.reduce((s, e) => s + (e.intent_accuracy ?? 0), 0) /
                  threadEvals.length,
              )}
            />
            <StatPill
              label="Completion Rate"
              metricKey="completion_rate"
              value={pct(
                threadEvals.filter((e) => e.success_status).length / threadEvals.length,
              )}
            />
            {summaryErrors > 0 ? (
              <StatPill
                label="Errors"
                value={`${summaryErrors} / ${summaryTotal}`}
                color="var(--color-error)"
              />
            ) : (
              <StatPill
                label="Completed"
                metricKey="completed"
                value={`${threadEvals.filter((e) => e.success_status).length} / ${threadEvals.length}`}
              />
            )}
          </div>

          <div className="flex gap-4 flex-wrap">
            {Object.keys(correctnessDist).length > 0 && (
              <div className="flex-1 min-w-[260px]">
                <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
                  Correctness
                </h3>
                <DistributionBar distribution={correctnessDist} order={CORRECTNESS_ORDER} />
              </div>
            )}
            {Object.keys(efficiencyDist).length > 0 && (
              <div className="flex-1 min-w-[260px]">
                <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
                  Efficiency
                </h3>
                <DistributionBar distribution={efficiencyDist} order={EFFICIENCY_ORDER} />
              </div>
            )}
          </div>

          {customEvalSummary.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
                Custom Evaluators
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
                {customEvalSummary.map(({ id, name, completed, errors }) => (
                  <div
                    key={id}
                    className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2"
                    style={{ borderLeftWidth: 3, borderLeftColor: errors > 0 ? STATUS_COLORS.hardFail : STATUS_COLORS.pass }}
                  >
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{name}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {completed} completed{errors > 0 ? `, ${errors} failed` : ""}
                    </p>
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
            <div className="flex">
              <button
                onClick={() => setView("table")}
                className={`px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-l-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  view === "table"
                    ? "bg-[var(--interactive-primary)] text-white border-[var(--interactive-primary)]"
                    : "bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setView("detail")}
                className={`px-3 py-1.5 text-sm border border-[var(--border-subtle)] border-l-0 rounded-r-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  view === "detail"
                    ? "bg-[var(--interactive-primary)] text-white border-[var(--interactive-primary)]"
                    : "bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                }`}
              >
                Detail
              </button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {allVerdicts.map((v) => {
                const def = getLabelDefinition(v, "correctness");
                return (
                  <button
                    key={v}
                    onClick={() => toggleVerdictFilter(v)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                      verdictFilter.has(v)
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

          {view === "table" && <EvalTable evaluations={filteredThreads} />}

          {view === "detail" && (
            <div className="flex flex-col gap-3">
              {filteredThreads.map((te) => (
                <ThreadDetailCard key={te.id} evaluation={te} />
              ))}
              {filteredThreads.length === 0 && (
                <EmptyState
                  icon={Search}
                  title="No threads match filters"
                  description="Try adjusting your search or verdict filters."
                  compact
                />
              )}
            </div>
          )}
        </>
      )}

      {adversarialEvals.length > 0 && <AdversarialSection
        evals={adversarialEvals}
        adversarialDist={adversarialDist}
        categoryDist={categoryDist}
        runId={run.run_id}
        isRunActive={isRunActive}
      />}

      {threadEvals.length === 0 && adversarialEvals.length === 0 && (
        isRunActive ? (
          <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--border-default)] rounded-lg py-10 px-6">
            <Loader2 className="h-6 w-6 text-[var(--color-info)] animate-spin" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Evaluations are being processed...
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              Results will appear here as threads are evaluated.
            </p>
          </div>
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="No evaluations found"
            description="This run has no evaluation results yet."
          />
        )
      )}

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

function AdversarialSection({
  evals,
  adversarialDist,
  categoryDist,
  runId,
  isRunActive,
}: {
  evals: AdversarialEvalRow[];
  adversarialDist: Record<string, number>;
  categoryDist: Record<string, number>;
  runId: string;
  isRunActive: boolean;
}) {
  const failedCount = evals.filter((e) => e.verdict == null).length;
  const successfulEvals = evals.filter((e) => e.verdict != null);
  const successfulCount = successfulEvals.length;

  return (
    <>
      {failedCount > 0 && !isRunActive && (
        <AdversarialErrorBanner errors={failedCount} total={evals.length} />
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill label="Tests" metricKey="total_tests" value={evals.length} />
        <StatPill
          label="Pass Rate"
          metricKey="pass_rate"
          value={successfulCount > 0 ? pct(
            successfulEvals.filter((e) => normalizeLabel(e.verdict!) === "PASS").length /
              successfulCount,
          ) : "N/A"}
        />
        <StatPill
          label="Goal Achievement"
          metricKey="goal_achievement"
          value={successfulCount > 0 ? pct(
            successfulEvals.filter((e) => e.goal_achieved).length /
              successfulCount,
          ) : "N/A"}
        />
        {failedCount > 0 ? (
          <StatPill
            label="Errors"
            value={`${failedCount} / ${evals.length}`}
            color="var(--color-error)"
          />
        ) : (
          <StatPill
            label="Avg Turns"
            metricKey="avg_turns"
            value={(
              evals.reduce((s, e) => s + e.total_turns, 0) /
              evals.length
            ).toFixed(1)}
          />
        )}
      </div>

      {Object.keys(adversarialDist).length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            Verdicts
          </h3>
          <DistributionBar distribution={adversarialDist} />
        </div>
      )}

      {Object.keys(categoryDist).length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
          {Object.entries(categoryDist).map(([cat, count]) => (
            <div
              key={cat}
              className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-2.5 py-2"
              style={{ borderLeftWidth: 3, borderLeftColor: CATEGORY_COLORS[cat] ?? STATUS_COLORS.default }}
            >
              <p className="text-sm font-semibold text-[var(--text-primary)]">{humanize(cat)}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{count} tests</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {evals.map((ae) => (
          <Link
            key={ae.id}
            to={`/kaira/runs/${runId}/adversarial/${ae.id}`}
            className="flex items-center justify-between gap-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2 hover:border-[var(--border-focus)] transition-colors"
            style={{
              borderLeftWidth: 3,
              borderLeftColor: ae.verdict == null
                ? STATUS_COLORS.failed
                : (CATEGORY_COLORS[ae.category] ?? STATUS_COLORS.default),
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {humanize(ae.category)}
              </span>
              <VerdictBadge verdict={ae.difficulty} category="difficulty" />
            </div>
            <div className="flex items-center gap-2">
              {ae.verdict != null ? (
                <>
                  <span className="text-xs text-[var(--text-muted)]">{ae.total_turns} turns</span>
                  <VerdictBadge verdict={ae.verdict} category="adversarial" />
                </>
              ) : (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white"
                  style={{ backgroundColor: 'var(--color-error)' }}
                >
                  Failed
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
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
      <p
        className={`text-lg font-bold mt-0.5 leading-tight${color ? "" : " text-[var(--text-primary)]"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function ThreadDetailCard({ evaluation: te }: { evaluation: ThreadEvalRow }) {
  const result = useMemo(() => unwrapSerializedDates(te.result), [te.result]);
  const messages = result?.thread?.messages ?? [];
  const worstVerdict = te.worst_correctness ?? "NOT APPLICABLE";

  return (
    <div
      className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: getVerdictColor(worstVerdict) }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] flex-wrap gap-2">
        <Link
          to={`/kaira/threads/${te.thread_id}`}
          className="font-mono text-[0.82rem] font-semibold text-[var(--text-brand)] hover:underline"
        >
          {te.thread_id}
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">{result?.thread?.message_count ?? messages.length}</strong> msgs
          </span>
          <span className="text-sm text-[var(--text-secondary)]">
            Intent: <strong className="text-[var(--text-primary)]">{te.intent_accuracy != null ? pct(te.intent_accuracy) : "\u2014"}</strong>
          </span>
          {te.worst_correctness && <VerdictBadge verdict={te.worst_correctness} category="correctness" />}
          {te.efficiency_verdict && <VerdictBadge verdict={te.efficiency_verdict} category="efficiency" />}
          <span className="text-sm">
            {te.success_status ? (
              <span className="text-[var(--color-success)]">{"\u2713"} Completed</span>
            ) : (
              <span className="text-[var(--color-error)]">{"\u2717"} Incomplete</span>
            )}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {messages.length > 0 && <ChatViewer messages={messages} />}

        {result?.efficiency_evaluation && (
          <EfficiencyBlock ee={result.efficiency_evaluation} />
        )}

        {result?.correctness_evaluations?.length > 0 && (
          <CorrectnessBlock evaluations={result.correctness_evaluations} />
        )}

        {result?.intent_evaluations?.length > 0 && (
          <IntentBlock evaluations={result.intent_evaluations} />
        )}

        {result?.custom_evaluations && Object.keys(result.custom_evaluations).length > 0 && (
          <CustomEvaluationsBlock evaluations={result.custom_evaluations} />
        )}
      </div>
    </div>
  );
}

function FrictionTurnRow({ turn }: { turn: any }) {
  const isBot = (turn.cause ?? "").toLowerCase() === "bot";
  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-sm border ${
        isBot
          ? "bg-[var(--surface-warning)] border-[var(--border-warning)]"
          : "bg-[var(--bg-secondary)] border-[var(--border-subtle)]"
      }`}
    >
      <span
        className={`shrink-0 mt-0.5 px-1.5 py-px rounded text-[0.6rem] font-bold uppercase ${
          isBot ? "bg-[var(--color-warning)] text-white" : "bg-[var(--text-muted)] text-white"
        }`}
      >
        {turn.cause ?? "?"}
      </span>
      <div className="min-w-0 flex-1">
        <span className={`font-semibold ${isBot ? "text-[var(--color-warning)]" : "text-[var(--text-primary)]"}`}>
          Turn {turn.turn ?? "?"}
        </span>
        {turn.description && (
          <p className={`mt-0.5 ${isBot ? "text-[var(--color-warning)]" : "text-[var(--text-secondary)]"}`} style={{ opacity: 0.8 }}>
            {turn.description}
          </p>
        )}
      </div>
    </div>
  );
}

function EfficiencyBlock({ ee }: { ee: any }) {
  return (
    <EvalSection
      title="Efficiency"
      verdict={ee.verdict}
      verdictCategory="efficiency"
      subtitle={ee.task_completed ? undefined : "Task not completed"}
    >
      {ee.reasoning && (
        <EvalCard accentColor={getVerdictColor(ee.verdict)}>
          <EvalCardBody>{ee.reasoning}</EvalCardBody>
        </EvalCard>
      )}
      {ee.friction_turns?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Friction Turns
          </p>
          {ee.friction_turns.map((ft: any, i: number) => (
            <FrictionTurnRow key={i} turn={ft} />
          ))}
        </div>
      )}
      {ee.abandonment_reason && (
        <EvalCard accentColor={STATUS_COLORS.hardFail}>
          <EvalCardHeader>
            <span className="text-xs uppercase tracking-wider text-[var(--color-error)] font-semibold">
              Abandonment Reason
            </span>
          </EvalCardHeader>
          <EvalCardBody>{ee.abandonment_reason}</EvalCardBody>
        </EvalCard>
      )}
      {ee.rule_compliance?.length > 0 && (
        <RuleComplianceGrid rules={ee.rule_compliance} />
      )}
    </EvalSection>
  );
}

function CorrectnessBlock({ evaluations }: { evaluations: any[] }) {
  const applicable = evaluations.filter(
    (c) => normalizeLabel(c.verdict) !== "NOT APPLICABLE",
  );
  if (applicable.length === 0) return null;

  return (
    <EvalSection
      title="Correctness"
      subtitle={`${applicable.length} evaluation${applicable.length !== 1 ? "s" : ""}`}
    >
      {applicable.map((ce, i) => (
        <EvalCard key={i} accentColor={getVerdictColor(ce.verdict)}>
          <EvalCardHeader>
            <VerdictBadge verdict={ce.verdict} category="correctness" />
            {ce.has_image_context && (
              <span className="inline-block px-1.5 py-px rounded text-xs font-semibold bg-[var(--color-accent-purple)] text-white">
                IMG
              </span>
            )}
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {ce.message?.query_text ?? ""}
            </span>
          </EvalCardHeader>
          {ce.reasoning && <EvalCardBody>{ce.reasoning}</EvalCardBody>}
          {ce.rule_compliance?.length > 0 && (
            <RuleComplianceGrid rules={ce.rule_compliance} />
          )}
        </EvalCard>
      ))}
    </EvalSection>
  );
}

function IntentBlock({ evaluations }: { evaluations: any[] }) {
  return (
    <EvalSection
      title="Intent Classification"
      subtitle={`${evaluations.length} evaluation${evaluations.length !== 1 ? "s" : ""}`}
    >
      {evaluations.map((ie, i) => (
        <EvalCard
          key={i}
          accentColor={ie.is_correct_intent ? STATUS_COLORS.pass : STATUS_COLORS.hardFail}
        >
          <EvalCardHeader>
            <span
              className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[0.6rem] font-bold text-white ${
                ie.is_correct_intent ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"
              }`}
            >
              {ie.is_correct_intent ? "\u2713" : "\u2717"}
            </span>
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {ie.message?.query_text ?? ""}
            </span>
          </EvalCardHeader>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[var(--text-secondary)]">
              Expected: <strong className="text-[var(--text-primary)]">{ie.message?.intent_detected ?? "\u2014"}</strong>
            </span>
            <span className="text-[var(--text-muted)]">|</span>
            <span className="text-[var(--text-secondary)]">
              Predicted: <strong className="text-[var(--text-primary)]">{ie.predicted_intent ?? "\u2014"}</strong>
            </span>
          </div>
          {ie.reasoning && <EvalCardBody>{ie.reasoning}</EvalCardBody>}
        </EvalCard>
      ))}
    </EvalSection>
  );
}

function CustomEvaluationsBlock({ evaluations }: { evaluations: Record<string, CustomEvaluationResult> }) {
  const entries = Object.values(evaluations);
  const completed = entries.filter(e => e.status === "completed");
  const failed = entries.filter(e => e.status === "failed");

  return (
    <EvalSection
      title="Custom Evaluators"
      subtitle={`${entries.length} evaluator${entries.length !== 1 ? "s" : ""}${failed.length > 0 ? ` (${failed.length} failed)` : ""}`}
    >
      {completed.map((ce) => (
        <EvalCard key={ce.evaluator_id} accentColor={STATUS_COLORS.pass}>
          <EvalCardHeader>
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)] shrink-0" />
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {ce.evaluator_name}
            </span>
          </EvalCardHeader>
          {ce.output && (
            <div className="space-y-1.5">
              {Object.entries(ce.output).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <span className="text-[var(--text-muted)] shrink-0 font-medium">{key}:</span>
                  <span className="text-[var(--text-primary)] break-words">
                    {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "\u2014")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </EvalCard>
      ))}
      {failed.map((ce) => (
        <EvalCard key={ce.evaluator_id} accentColor={STATUS_COLORS.hardFail}>
          <EvalCardHeader>
            <XCircle className="h-3.5 w-3.5 text-[var(--color-error)] shrink-0" />
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {ce.evaluator_name}
            </span>
          </EvalCardHeader>
          {ce.error && <EvalCardBody>{ce.error}</EvalCardBody>}
        </EvalCard>
      ))}
    </EvalSection>
  );
}
