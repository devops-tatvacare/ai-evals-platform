import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import type { Run, ThreadEvalRow, AdversarialEvalRow } from "@/types";
import {
  fetchRun,
  fetchRunThreads,
  fetchRunAdversarial,
  deleteRun,
} from "@/services/api/evalRunsApi";
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
import { formatTimestamp, formatDuration, humanize, pct, normalizeLabel } from "@/utils/evalFormatters";

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[0.8rem]">
      <span className="text-[var(--text-muted)] w-28 shrink-0">{label}</span>
      <span className="text-[var(--text-primary)]">{value}</span>
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

  const handleDelete = useCallback(async () => {
    if (!runId || !run) return;
    if (!window.confirm(`Delete run ${run.run_id.slice(0, 12)}… and all its evaluations? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteRun(runId);
      navigate("/kaira/runs", { replace: true });
    } catch (e: any) {
      setError(e.message);
      setDeleting(false);
    }
  }, [runId, run, navigate]);

  useEffect(() => {
    if (!runId) return;
    Promise.all([
      fetchRun(runId),
      fetchRunThreads(runId).catch(() => ({ evaluations: [] as ThreadEvalRow[] })),
      fetchRunAdversarial(runId).catch(() => ({ evaluations: [] as AdversarialEvalRow[] })),
    ])
      .then(([r, t, a]) => {
        setRun(r);
        setThreadEvals(t.evaluations);
        setAdversarialEvals(a.evaluations);
      })
      .catch((e: Error) => setError(e.message));
  }, [runId]);

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

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (!run) {
    return <div className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">Loading...</div>;
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
    const n = normalizeLabel(ae.verdict);
    adversarialDist[n] = (adversarialDist[n] ?? 0) + 1;
    categoryDist[ae.category] = (categoryDist[ae.category] ?? 0) + 1;
  }

  const isAdversarial = run.command === "adversarial";

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
      <div className="flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--text-muted)]">
        <Link to="/kaira/runs" className="hover:text-[var(--text-brand)]">Runs</Link>
        <span>/</span>
        <span className="font-mono text-[var(--text-secondary)]">{run.run_id.slice(0, 12)}</span>
      </div>

      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="text-base font-bold text-[var(--text-primary)]">{run.command}</h1>
          <VerdictBadge verdict={run.status} category="status" />
          <div className="ml-auto flex items-center gap-2">
            <Link
              to={`/kaira/logs?run_id=${run.run_id}`}
              className="px-2.5 py-1 text-[var(--text-xs)] font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              View Logs
            </Link>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-2.5 py-1 text-[var(--text-xs)] font-medium text-[var(--color-error)] bg-[var(--surface-error)] border border-[var(--border-error)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
            >
              {deleting ? "Deleting…" : "Delete Run"}
            </button>
          </div>
        </div>
        <div className="space-y-0.5">
          <MetaRow label="Run ID" value={<code className="text-[var(--text-xs)]">{run.run_id}</code>} />
          <MetaRow label="Timestamp" value={formatTimestamp(run.timestamp)} />
          <MetaRow label="Duration" value={formatDuration(run.duration_seconds)} />
          <MetaRow label="LLM" value={`${run.llm_provider}/${run.llm_model}`} />
          <MetaRow label="Temperature" value={run.eval_temperature} />
          {run.data_path && <MetaRow label="Data Path" value={run.data_path} />}
          {run.error_message && (
            <MetaRow label="Error" value={<span className="text-[var(--color-error)]">{run.error_message}</span>} />
          )}
        </div>
      </div>

      {threadEvals.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill label="Threads" metricKey="total_threads" value={threadEvals.length} />
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
            <StatPill
              label="Completed"
              metricKey="completed"
              value={`${threadEvals.filter((e) => e.success_status).length} / ${threadEvals.length}`}
            />
          </div>

          <div className="flex gap-4 flex-wrap">
            {Object.keys(correctnessDist).length > 0 && (
              <div className="flex-1 min-w-[260px]">
                <h3 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
                  Correctness
                </h3>
                <DistributionBar distribution={correctnessDist} order={CORRECTNESS_ORDER} />
              </div>
            )}
            {Object.keys(efficiencyDist).length > 0 && (
              <div className="flex-1 min-w-[260px]">
                <h3 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
                  Efficiency
                </h3>
                <DistributionBar distribution={efficiencyDist} order={EFFICIENCY_ORDER} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search thread ID, verdict..."
              className="px-2.5 py-1.5 text-[0.8rem] border border-[var(--border-default)] rounded-md w-60 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/30 focus:border-[var(--border-focus)]"
            />
            <div className="flex">
              <button
                onClick={() => setView("table")}
                className={`px-3 py-1.5 text-[var(--text-sm)] border border-[var(--border-subtle)] rounded-l-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  view === "table"
                    ? "bg-[var(--interactive-primary)] text-white border-[var(--interactive-primary)]"
                    : "bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setView("detail")}
                className={`px-3 py-1.5 text-[var(--text-sm)] border border-[var(--border-subtle)] border-l-0 rounded-r-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
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
                    className={`px-2 py-0.5 rounded-full text-[var(--text-xs)] font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
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
            <span className="text-[var(--text-xs)] text-[var(--text-muted)] ml-auto">
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
                <p className="text-[0.8rem] text-[var(--text-muted)] text-center py-6">
                  No threads match filters
                </p>
              )}
            </div>
          )}
        </>
      )}

      {adversarialEvals.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill label="Tests" metricKey="total_tests" value={adversarialEvals.length} />
            <StatPill
              label="Pass Rate"
              metricKey="pass_rate"
              value={pct(
                adversarialEvals.filter((e) => normalizeLabel(e.verdict) === "PASS").length /
                  adversarialEvals.length,
              )}
            />
            <StatPill
              label="Goal Achievement"
              metricKey="goal_achievement"
              value={pct(
                adversarialEvals.filter((e) => e.goal_achieved).length /
                  adversarialEvals.length,
              )}
            />
            <StatPill
              label="Avg Turns"
              metricKey="avg_turns"
              value={(
                adversarialEvals.reduce((s, e) => s + e.total_turns, 0) /
                adversarialEvals.length
              ).toFixed(1)}
            />
          </div>

          {Object.keys(adversarialDist).length > 0 && (
            <div>
              <h3 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
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
                  <p className="text-[var(--text-sm)] font-semibold text-[var(--text-primary)]">{humanize(cat)}</p>
                  <p className="text-[var(--text-xs)] text-[var(--text-muted)] mt-0.5">{count} tests</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            {adversarialEvals.map((ae) => (
              <Link
                key={ae.id}
                to={`/kaira/runs/${run.run_id}/adversarial/${ae.id}`}
                className="flex items-center justify-between gap-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2 hover:border-[var(--border-focus)] transition-colors"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: CATEGORY_COLORS[ae.category] ?? STATUS_COLORS.default,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[0.8rem] font-semibold text-[var(--text-primary)]">
                    {humanize(ae.category)}
                  </span>
                  <VerdictBadge verdict={ae.difficulty} category="difficulty" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-xs)] text-[var(--text-muted)]">{ae.total_turns} turns</span>
                  <VerdictBadge verdict={ae.verdict} category="adversarial" />
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {threadEvals.length === 0 && adversarialEvals.length === 0 && !isAdversarial && (
        <p className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">
          No evaluations found for this run.
        </p>
      )}
    </div>
  );
}

function StatPill({ label, value, metricKey }: { label: string; value: string | number; metricKey?: string }) {
  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2">
      <div className="flex items-center gap-1">
        <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</p>
        {metricKey && <MetricInfo metricKey={metricKey} />}
      </div>
      <p className="text-lg font-bold text-[var(--text-primary)] mt-0.5 leading-tight">{value}</p>
    </div>
  );
}

function ThreadDetailCard({ evaluation: te }: { evaluation: ThreadEvalRow }) {
  const result = te.result;
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
          <span className="text-[var(--text-sm)] text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">{result?.thread?.message_count ?? messages.length}</strong> msgs
          </span>
          <span className="text-[var(--text-sm)] text-[var(--text-secondary)]">
            Intent: <strong className="text-[var(--text-primary)]">{te.intent_accuracy != null ? pct(te.intent_accuracy) : "\u2014"}</strong>
          </span>
          {te.worst_correctness && <VerdictBadge verdict={te.worst_correctness} category="correctness" />}
          {te.efficiency_verdict && <VerdictBadge verdict={te.efficiency_verdict} category="efficiency" />}
          <span className="text-[var(--text-sm)]">
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
      </div>
    </div>
  );
}

function FrictionTurnRow({ turn }: { turn: any }) {
  const isBot = (turn.cause ?? "").toLowerCase() === "bot";
  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-[var(--text-sm)] border ${
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
          <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
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
            <span className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-error)] font-semibold">
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
              <span className="inline-block px-1.5 py-px rounded text-[var(--text-xs)] font-semibold bg-[var(--color-accent-purple)] text-white">
                IMG
              </span>
            )}
            <span className="text-[0.8rem] font-semibold text-[var(--text-primary)] truncate">
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
            <span className="text-[0.8rem] font-semibold text-[var(--text-primary)] truncate">
              {ie.message?.query_text ?? ""}
            </span>
          </EvalCardHeader>
          <div className="flex items-center gap-3 text-[var(--text-sm)]">
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
