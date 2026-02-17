import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { ThreadEvalRow } from "@/types";
import VerdictBadge from "./VerdictBadge";
import { CompactTranscript } from "./TranscriptViewer";
import RuleComplianceGrid from "./RuleComplianceGrid";
import { pct, normalizeLabel } from "@/utils/evalFormatters";
import { getVerdictColor } from "@/utils/evalColors";
import { STATUS_COLORS } from "@/utils/statusColors";

interface Props {
  evaluations: ThreadEvalRow[];
}

type SortKey = "thread_id" | "intent_accuracy" | "worst_correctness" | "efficiency_verdict" | "success_status";
type SortDir = "asc" | "desc";

const CORRECTNESS_RANK: Record<string, number> = {
  "PASS": 0, "NOT APPLICABLE": 1, "SOFT FAIL": 2, "HARD FAIL": 3, "CRITICAL": 4,
};

const EFFICIENCY_RANK: Record<string, number> = {
  "EFFICIENT": 0, "ACCEPTABLE": 1, "FRICTION": 2, "BROKEN": 3,
};

function getRank(value: string | null, ranks: Record<string, number>): number {
  if (!value) return 99;
  return ranks[normalizeLabel(value)] ?? 5;
}

export default function EvalTable({ evaluations }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("thread_id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "thread_id":
          cmp = a.thread_id.localeCompare(b.thread_id);
          break;
        case "intent_accuracy":
          cmp = (a.intent_accuracy ?? 0) - (b.intent_accuracy ?? 0);
          break;
        case "worst_correctness":
          cmp = getRank(a.worst_correctness, CORRECTNESS_RANK) - getRank(b.worst_correctness, CORRECTNESS_RANK);
          break;
        case "efficiency_verdict":
          cmp = getRank(a.efficiency_verdict, EFFICIENCY_RANK) - getRank(b.efficiency_verdict, EFFICIENCY_RANK);
          break;
        case "success_status":
          cmp = a.success_status - b.success_status;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [evaluations, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={`text-left px-2.5 py-2 text-xs uppercase tracking-wider cursor-pointer select-none whitespace-nowrap border-b-2 border-[var(--border-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1 ${
          active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        {label}
        {active && <span className="ml-1 text-[0.6rem]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
      </th>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead>
            <tr>
              <SortHeader label="Thread ID" k="thread_id" />
              <SortHeader label="Msgs" k="thread_id" />
              <SortHeader label="Intent Acc" k="intent_accuracy" />
              <SortHeader label="Correctness" k="worst_correctness" />
              <SortHeader label="Efficiency" k="efficiency_verdict" />
              <SortHeader label="Completed" k="success_status" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const isExpanded = expandedId === e.id;
              return (
                <ExpandableRow
                  key={e.id}
                  evaluation={e}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedId(isExpanded ? null : e.id)}
                />
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3">
                  <EmptyState
                    icon={ClipboardList}
                    title="No evaluations found"
                    compact
                    className="border-none"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-1.5">
        {sorted.length} of {evaluations.length} evaluations
      </p>
    </div>
  );
}

function ExpandableRow({
  evaluation: e,
  isExpanded,
  onToggle,
}: {
  evaluation: ThreadEvalRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const result = e.result;
  const messages = result?.thread?.messages ?? [];
  const msgCount = result?.thread?.message_count ?? messages.length;

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
      >
        <td className="px-2.5 py-2 text-sm font-mono text-[var(--text-primary)]">
          <Link
            to={`/kaira/threads/${e.thread_id}`}
            className="text-[var(--text-brand)] hover:underline"
            onClick={(ev) => ev.stopPropagation()}
          >
            {e.thread_id}
          </Link>
        </td>
        <td className="px-2.5 py-2 text-sm text-right text-[var(--text-secondary)]">
          {msgCount}
        </td>
        <td className="px-2.5 py-2 text-sm text-right text-[var(--text-secondary)]">
          {e.intent_accuracy != null ? pct(e.intent_accuracy) : "\u2014"}
        </td>
        <td className="px-2.5 py-2">
          {e.worst_correctness ? (
            <VerdictBadge verdict={e.worst_correctness} category="correctness" />
          ) : (
            <span className="text-[var(--text-muted)]">\u2014</span>
          )}
        </td>
        <td className="px-2.5 py-2">
          {e.efficiency_verdict ? (
            <VerdictBadge verdict={e.efficiency_verdict} category="efficiency" />
          ) : (
            <span className="text-[var(--text-muted)]">\u2014</span>
          )}
        </td>
        <td className="px-2.5 py-2 text-center text-sm">
          {e.success_status ? (
            <span className="text-[var(--color-success)]">{"\u2713"}</span>
          ) : (
            <span className="text-[var(--color-error)]">{"\u2717"}</span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-[var(--bg-secondary)]">
          <td colSpan={6} className="p-0">
            <ExpandedContent evaluation={e} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedContent({ evaluation: e }: { evaluation: ThreadEvalRow }) {
  const result = e.result;
  const messages = result?.thread?.messages ?? [];

  return (
    <div className="px-4 py-3 space-y-3">
      {messages.length > 0 && <CompactTranscript messages={messages} />}

      {result?.efficiency_evaluation?.reasoning && (
        <details className="group">
          <summary className="text-sm font-semibold text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1 rounded">
            Efficiency: <VerdictBadge verdict={result.efficiency_evaluation.verdict} category="efficiency" size="sm" />
            {result.efficiency_evaluation.task_completed ? " (completed)" : " (incomplete)"}
          </summary>
          <div className="mt-1.5 pl-0.5">
            <div
              className="text-sm text-[var(--text-secondary)] p-2.5 bg-[var(--bg-secondary)] rounded border-l-3 border-[var(--border-subtle)]"
              style={{ borderLeftWidth: 3 }}
            >
              {result.efficiency_evaluation.reasoning}
              {result.efficiency_evaluation.friction_turns?.length > 0 && (
                <div className="mt-2">
                  <strong className="text-xs">Friction turns:</strong>
                  <ul className="list-disc ml-4 mt-0.5">
                    {result.efficiency_evaluation.friction_turns.map((ft, i) => (
                      <li key={i} className="text-sm">
                        Turn {ft.turn ?? "?"} [{ft.cause ?? "?"}]: {ft.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {result.efficiency_evaluation.rule_compliance?.length > 0 && (
              <div className="mt-2">
                <RuleComplianceGrid rules={result.efficiency_evaluation.rule_compliance} />
              </div>
            )}
          </div>
        </details>
      )}

      {result?.correctness_evaluations?.length > 0 && (() => {
        const applicable = result.correctness_evaluations.filter(
          (c) => normalizeLabel(c.verdict) !== "NOT APPLICABLE",
        );
        if (applicable.length === 0) return null;
        return (
          <details className="group">
            <summary className="text-sm font-semibold text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1 rounded">
              Correctness Evaluations ({applicable.length})
            </summary>
            <div className="mt-1.5 space-y-1.5">
              {applicable.map((ce, i) => (
                <div
                  key={i}
                  className="text-sm p-2 bg-[var(--bg-secondary)] rounded"
                  style={{
                    borderLeft: `3px solid ${getVerdictColor(ce.verdict)}`,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    {ce.has_image_context && (
                      <span className="inline-block px-1.5 py-px rounded text-xs font-semibold bg-[var(--color-accent-purple)] text-white">
                        IMG
                      </span>
                    )}
                    <span className="font-semibold text-[var(--text-primary)]">
                      {ce.message?.query_text ?? ""}
                    </span>
                  </div>
                  <VerdictBadge verdict={ce.verdict} category="correctness" />
                  {ce.reasoning && (
                    <p className="text-[var(--text-secondary)] mt-1">{ce.reasoning}</p>
                  )}
                  {ce.rule_compliance?.length > 0 && (
                    <div className="mt-1.5">
                      <RuleComplianceGrid rules={ce.rule_compliance} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        );
      })()}

      {result?.intent_evaluations?.length > 0 && (
        <details className="group">
          <summary className="text-sm font-semibold text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1 rounded">
            Intent Evaluations ({result.intent_evaluations.length})
          </summary>
          <div className="mt-1.5 space-y-1">
            {result.intent_evaluations.map((ie, i) => (
              <div
                key={i}
                className="text-sm p-2 bg-[var(--bg-secondary)] rounded"
                style={{
                  borderLeft: `3px solid ${ie.is_correct_intent ? STATUS_COLORS.pass : STATUS_COLORS.hardFail}`,
                }}
              >
                <div className="font-semibold text-[var(--text-primary)] mb-0.5">
                  {ie.message?.query_text ?? ""}
                </div>
                <span className="text-xs">
                  Expected: <strong>{ie.predicted_intent ? ie.message?.intent_detected : "\u2014"}</strong>
                  {" | "}Predicted: <strong>{ie.predicted_intent ?? "\u2014"}</strong>
                  {" | "}
                  {ie.is_correct_intent ? (
                    <span className="text-[var(--color-success)]">{"\u2713"} Correct</span>
                  ) : (
                    <span className="text-[var(--color-error)]">{"\u2717"} Incorrect</span>
                  )}
                </span>
                {ie.reasoning && (
                  <p className="text-[var(--text-secondary)] mt-0.5">{ie.reasoning}</p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
