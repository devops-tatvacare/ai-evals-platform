import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import type { AdversarialEvalRow } from "@/types";
import { fetchRunAdversarial } from "@/services/api/evalRunsApi";
import { VerdictBadge, TranscriptViewer, RuleComplianceGrid } from "../components";
import { CATEGORY_COLORS } from "@/utils/evalColors";
import { STATUS_COLORS } from "@/utils/statusColors";
import { humanize, unwrapSerializedDates } from "@/utils/evalFormatters";

export default function AdversarialDetail() {
  const { runId, evalId } = useParams<{ runId: string; evalId: string }>();
  const [evalItem, setEvalItem] = useState<AdversarialEvalRow | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId) return;
    fetchRunAdversarial(runId)
      .then((r) => {
        const match = r.evaluations.find((e) => String(e.id) === evalId);
        setEvalItem(match ?? r.evaluations[0] ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [runId, evalId]);

  const result = useMemo(
    () => evalItem ? unwrapSerializedDates(evalItem.result) : null,
    [evalItem],
  );

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  if (!evalItem || !result) {
    return <div className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">Loading...</div>;
  }

  const tc = result.test_case;
  const transcript = result.transcript;
  const isFailure = evalItem.verdict == null;
  const infraError = evalItem.error ?? result.error ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--text-muted)]">
        <Link to="/kaira/runs" className="hover:text-[var(--text-brand)]">Runs</Link>
        <span>/</span>
        <Link to={`/kaira/runs/${runId}`} className="hover:text-[var(--text-brand)] font-mono">
          {runId?.slice(0, 12)}
        </Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">Adversarial Test</span>
      </div>

      {/* Error banner for infra failures */}
      {isFailure && infraError && (
        <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded-md px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
          <div>
            <span className="text-[var(--text-sm)] text-[var(--color-error)] font-medium">
              Test failed due to infrastructure error
            </span>
            <p className="text-[var(--text-xs)] text-[var(--color-error)] mt-0.5" style={{ opacity: 0.8 }}>
              {infraError}
            </p>
          </div>
        </div>
      )}

      <div
        className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3"
        style={{
          borderLeftWidth: 4,
          borderLeftColor: isFailure
            ? STATUS_COLORS.failed
            : (CATEGORY_COLORS[tc.category] ?? STATUS_COLORS.default),
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-[var(--text-primary)]">
              {humanize(tc.category)}
            </h1>
            <VerdictBadge verdict={tc.difficulty} category="difficulty" />
          </div>
          {isFailure ? (
            <span
              className="inline-flex items-center px-2.5 py-1 rounded text-[var(--text-sm)] font-semibold text-white"
              style={{ backgroundColor: 'var(--color-error)' }}
            >
              Failed
            </span>
          ) : (
            <VerdictBadge verdict={result.verdict!} category="adversarial" size="md" />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded p-2.5 text-[0.8rem]">
          <div>
            <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              Synthetic Input
            </p>
            <p className="mt-px text-[var(--text-primary)]">{tc.synthetic_input}</p>
          </div>
          <div>
            <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              Expected Behavior
            </p>
            <p className="mt-px text-[var(--text-primary)]">{tc.expected_behavior}</p>
          </div>
          <div>
            <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
              Goal Type
            </p>
            <p className="mt-px text-[var(--text-primary)]">{tc.goal_type}</p>
          </div>
          {!isFailure && transcript && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                Goal Achieved
              </p>
              <p className="mt-px text-[var(--text-primary)]">
                {transcript.goal_achieved ? "Yes" : "No"}
                {!transcript.goal_achieved && transcript.abandonment_reason && (
                  <span className="text-[var(--color-error)] ml-1">
                    ({transcript.abandonment_reason})
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {!isFailure && (result.failure_modes?.length ?? 0) > 0 && (
          <div className="flex gap-1 flex-wrap mt-2">
            {result.failure_modes!.map((fm: string, i: number) => (
              <span
                key={i}
                className="bg-[var(--surface-error)] border border-[var(--border-error)] text-[var(--color-error)] px-1.5 py-px rounded text-[var(--text-xs)] font-medium"
              >
                {fm}
              </span>
            ))}
          </div>
        )}

        {!isFailure && result.reasoning && (
          <div className="mt-2">
            <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-0.5">
              Reasoning
            </p>
            <p className="text-[0.8rem] text-[var(--text-secondary)]">{result.reasoning}</p>
          </div>
        )}
      </div>

      {/* Show transcript if available (full for successes, partial for failures) */}
      {transcript && transcript.turns?.length > 0 && (
        <div>
          <h2 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            {isFailure ? "Partial " : ""}Conversation Transcript ({transcript.total_turns} turns)
          </h2>
          <TranscriptViewer turns={transcript.turns} />
        </div>
      )}

      {!isFailure && (result.rule_compliance?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1.5">
            Rule Compliance
          </h2>
          <RuleComplianceGrid rules={result.rule_compliance!} />
        </div>
      )}
    </div>
  );
}
