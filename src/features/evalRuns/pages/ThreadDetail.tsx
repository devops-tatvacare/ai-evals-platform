import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import type { ThreadEvalRow } from "@/types";
import { fetchThreadHistory } from "@/services/api/evalRunsApi";
import {
  VerdictBadge,
  RuleComplianceGrid,
  EvalSection,
  EvalCard,
  EvalCardHeader,
  EvalCardBody,
} from "../components";
import { ChatViewer } from "../components/TranscriptViewer";
import { getVerdictColor } from "@/config/labelDefinitions";
import { STATUS_COLORS } from "@/utils/statusColors";
import { formatTimestamp, pct } from "@/utils/evalFormatters";

export default function ThreadDetail() {
  const { threadId } = useParams<{ threadId: string }>();
  const [history, setHistory] = useState<ThreadEvalRow[]>([]);
  const [selected, setSelected] = useState<number>(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!threadId) return;
    fetchThreadHistory(threadId)
      .then((r) => setHistory(r.history))
      .catch((e: Error) => setError(e.message));
  }, [threadId]);

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--text-muted)]">
          <Link to="/kaira/runs" className="hover:text-[var(--text-brand)]">Runs</Link>
          <span>/</span>
          <span className="font-mono">{threadId}</span>
        </div>
        <p className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">
          No evaluation history found for this thread.
        </p>
      </div>
    );
  }

  const current = history[selected];
  const result = current?.result;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--text-muted)]">
        <Link to="/kaira/runs" className="hover:text-[var(--text-brand)]">Runs</Link>
        <span>/</span>
        <span className="font-mono text-[var(--text-secondary)]">{threadId}</span>
      </div>

      <h1 className="text-base font-bold text-[var(--text-primary)]">Thread History</h1>

      <div className="flex gap-1.5 flex-wrap">
        {history.map((h, i) => (
          <button
            key={h.id ?? i}
            onClick={() => setSelected(i)}
            className={`px-2.5 py-1.5 text-[var(--text-xs)] rounded border transition-colors ${
              selected === i
                ? "border-[var(--border-info)] bg-[var(--surface-info)] text-[var(--color-info)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            }`}
          >
            <div className="font-medium">{formatTimestamp(h.created_at)}</div>
            <div className="flex gap-1 mt-0.5">
              {h.worst_correctness && <VerdictBadge verdict={h.worst_correctness} category="correctness" />}
              {h.efficiency_verdict && <VerdictBadge verdict={h.efficiency_verdict} category="efficiency" />}
            </div>
          </button>
        ))}
      </div>

      {current && (
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3 space-y-4">
          <div className="flex flex-wrap gap-4 text-[0.8rem]">
            <div>
              <span className="text-[var(--text-muted)]">Run: </span>
              <Link
                to={`/kaira/runs/${current.run_id}`}
                className="text-[var(--text-brand)] hover:underline font-mono text-[var(--text-xs)]"
              >
                {current.run_id.slice(0, 12)}
              </Link>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Intent Accuracy: </span>
              <span className="font-semibold">
                {current.intent_accuracy != null ? pct(current.intent_accuracy) : "\u2014"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">Correctness: </span>
              {current.worst_correctness ? (
                <VerdictBadge verdict={current.worst_correctness} category="correctness" />
              ) : "\u2014"}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[var(--text-muted)]">Efficiency: </span>
              {current.efficiency_verdict ? (
                <VerdictBadge verdict={current.efficiency_verdict} category="efficiency" />
              ) : "\u2014"}
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Completed: </span>
              {current.success_status ? (
                <span className="text-[var(--color-success)]">{"\u2713"}</span>
              ) : (
                <span className="text-[var(--color-error)]">{"\u2717"}</span>
              )}
            </div>
          </div>

          {result?.thread?.messages && result.thread.messages.length > 0 && (
            <div>
              <h3 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
                Conversation ({result.thread.message_count} messages)
              </h3>
              <ChatViewer messages={result.thread.messages} />
            </div>
          )}

          {result?.efficiency_evaluation && (
            <EfficiencySection eval={result.efficiency_evaluation} />
          )}

          {result?.correctness_evaluations && result.correctness_evaluations.length > 0 && (
            <CorrectnessSection evaluations={result.correctness_evaluations} />
          )}

          {result?.intent_evaluations && result.intent_evaluations.length > 0 && (
            <IntentSection evaluations={result.intent_evaluations} />
          )}
        </div>
      )}
    </div>
  );
}

function EfficiencySection({ eval: ee }: { eval: any }) {
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
          isBot
            ? "bg-[var(--color-warning)] text-white"
            : "bg-[var(--text-muted)] text-white"
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

function CorrectnessSection({ evaluations }: { evaluations: any[] }) {
  const applicable = evaluations.filter(
    (c) => (c.verdict ?? "").replace(/_/g, " ").toUpperCase().trim() !== "NOT APPLICABLE",
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

function IntentSection({ evaluations }: { evaluations: any[] }) {
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
