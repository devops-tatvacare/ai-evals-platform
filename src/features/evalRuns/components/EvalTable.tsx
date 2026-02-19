import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardList, CheckCircle2, XCircle } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { ThreadEvalRow, EvaluatorDescriptor, CustomEvaluationResult } from "@/types";
import VerdictBadge from "./VerdictBadge";
import { OutputFieldRenderer } from "./OutputFieldRenderer";
import { CompactTranscript } from "./TranscriptViewer";
import RuleComplianceGrid from "./RuleComplianceGrid";
import { pct, normalizeLabel, unwrapSerializedDates } from "@/utils/evalFormatters";
import { getVerdictColor } from "@/utils/evalColors";
import { STATUS_COLORS } from "@/utils/statusColors";
import EvalSection, { EvalCard, EvalCardHeader, EvalCardBody } from "./EvalSection";

interface Props {
  evaluations: ThreadEvalRow[];
  evaluatorDescriptors?: EvaluatorDescriptor[];
}

type SortDir = "asc" | "desc";

const CORRECTNESS_RANK: Record<string, number> = {
  "PASS": 0, "NOT APPLICABLE": 1, "SOFT FAIL": 2, "HARD FAIL": 3, "CRITICAL": 4,
};

const EFFICIENCY_RANK: Record<string, number> = {
  "EFFICIENT": 0, "ACCEPTABLE": 1, "FRICTION": 2, "BROKEN": 3,
};

const DEFAULT_DESCRIPTORS: EvaluatorDescriptor[] = [
  {
    id: 'intent',
    name: 'Intent Acc',
    type: 'built-in',
    primaryField: { key: 'intent_accuracy', format: 'percentage' },
  },
  {
    id: 'correctness',
    name: 'Correctness',
    type: 'built-in',
    primaryField: { key: 'worst_correctness', format: 'verdict' },
  },
  {
    id: 'efficiency',
    name: 'Efficiency',
    type: 'built-in',
    primaryField: { key: 'efficiency_verdict', format: 'verdict' },
  },
];

function getRank(value: string | null, ranks: Record<string, number>): number {
  if (!value) return 99;
  return ranks[normalizeLabel(value)] ?? 5;
}

/** Inline badge for meta-states (Failed / Skipped). Not a verdict — intentionally not VerdictBadge. */
function StatusBadge({ status }: { status: "failed" | "skipped" }) {
  const isFailed = status === "failed";
  return (
    <span
      className={`inline-block rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide leading-snug ${
        isFailed
          ? "bg-[var(--color-error)] text-white"
          : "bg-[var(--text-muted)] text-white opacity-60"
      }`}
    >
      {isFailed ? "Failed" : "Skipped"}
    </span>
  );
}

/** Inline section shown in expanded detail when an evaluator failed. */
function EvalFailedSection({ label, errorMsg }: { label: string; errorMsg: string }) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-error)] border-[var(--border-error)]"
    >
      <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold text-[var(--text-primary)]">{label}:</span>{" "}
        <span className="text-[var(--text-secondary)]">{errorMsg}</span>
      </div>
    </div>
  );
}

/** Get cell value and state for a given evaluator descriptor. */
function getCellValue(
  evaluation: ThreadEvalRow,
  desc: EvaluatorDescriptor,
): { value: unknown; state: 'ok' | 'failed' | 'skipped' } {
  const result = evaluation.result as unknown as Record<string, unknown> | undefined;

  if (desc.type === 'built-in') {
    const failedEvals = (result?.failed_evaluators ?? {}) as Record<string, string>;
    const skippedEvals = (result?.skipped_evaluators ?? []) as string[];

    if (failedEvals[desc.id]) return { value: null, state: 'failed' };
    if (skippedEvals.includes(desc.id)) return { value: null, state: 'skipped' };

    switch (desc.primaryField?.key) {
      case 'intent_accuracy': return { value: evaluation.intent_accuracy, state: 'ok' };
      case 'worst_correctness': return { value: evaluation.worst_correctness, state: 'ok' };
      case 'efficiency_verdict': return { value: evaluation.efficiency_verdict, state: 'ok' };
      default: return { value: null, state: 'ok' };
    }
  }

  // Custom evaluator — read from result.custom_evaluations
  const customEvals = (result?.custom_evaluations ?? {}) as Record<string, {
    status: string;
    output?: Record<string, unknown>;
    error?: string;
  }>;

  const ce = customEvals[desc.id];
  if (!ce) return { value: null, state: 'skipped' };
  if (ce.status === 'failed') return { value: null, state: 'failed' };

  const primaryKey = desc.primaryField?.key;
  if (primaryKey && ce.output) {
    return { value: ce.output[primaryKey], state: 'ok' };
  }

  return { value: null, state: 'ok' };
}

/** Render a cell value based on its evaluator descriptor's format. */
function CellRenderer({ desc, value }: { desc: EvaluatorDescriptor; value: unknown }) {
  if (value == null) return <span className="text-[var(--text-muted)]">{"\u2014"}</span>;

  switch (desc.primaryField?.format) {
    case 'percentage': {
      const num = Number(value);
      return <span className="text-sm font-medium">{pct(num)}</span>;
    }
    case 'verdict':
      return <VerdictBadge verdict={String(value)} category={desc.type === 'built-in' ? desc.id as any : 'correctness'} />;
    case 'number': {
      const num = Number(value);
      const display = num <= 1 ? `${(num * 100).toFixed(0)}%` : String(num);
      return <span className="text-sm font-medium">{display}</span>;
    }
    case 'boolean':
      return value
        ? <span className="text-[var(--color-success)]">Pass</span>
        : <span className="text-[var(--color-error)]">Fail</span>;
    default:
      return <span className="text-sm truncate max-w-[100px]">{String(value)}</span>;
  }
}

export default function EvalTable({ evaluations, evaluatorDescriptors }: Props) {
  const descriptors = evaluatorDescriptors ?? DEFAULT_DESCRIPTORS;
  const [sortKey, setSortKey] = useState<string>("thread_id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      let cmp = 0;

      if (sortKey === "thread_id") {
        cmp = a.thread_id.localeCompare(b.thread_id);
      } else if (sortKey === "success_status") {
        cmp = a.success_status - b.success_status;
      } else if (sortKey === "intent_accuracy") {
        cmp = (a.intent_accuracy ?? 0) - (b.intent_accuracy ?? 0);
      } else if (sortKey === "worst_correctness") {
        cmp = getRank(a.worst_correctness, CORRECTNESS_RANK) - getRank(b.worst_correctness, CORRECTNESS_RANK);
      } else if (sortKey === "efficiency_verdict") {
        cmp = getRank(a.efficiency_verdict, EFFICIENCY_RANK) - getRank(b.efficiency_verdict, EFFICIENCY_RANK);
      } else if (sortKey.startsWith("custom_")) {
        const evalId = sortKey.slice(7);
        const getCustomVal = (te: ThreadEvalRow) => {
          const result = te.result as unknown as Record<string, unknown> | undefined;
          const customEvals = (result?.custom_evaluations ?? {}) as Record<string, any>;
          const ce = customEvals[evalId];
          if (!ce || ce.status !== 'completed' || !ce.output) return '';
          const desc = descriptors.find(d => d.id === evalId);
          const primaryKey = desc?.primaryField?.key;
          if (primaryKey) {
            const val = ce.output[primaryKey];
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return val;
            if (typeof val === 'boolean') return val ? 1 : 0;
          }
          return '';
        };
        const valA = getCustomVal(a);
        const valB = getCustomVal(b);
        if (typeof valA === 'number' && typeof valB === 'number') {
          cmp = valA - valB;
        } else {
          cmp = String(valA).localeCompare(String(valB));
        }
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [evaluations, sortKey, sortDir, descriptors]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortHeader({ label, k }: { label: string; k: string }) {
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

  // Total column count: Thread ID + Msgs + dynamic evaluators + Completed
  const totalCols = 2 + descriptors.length + 1;

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead>
            <tr>
              <SortHeader label="Thread ID" k="thread_id" />
              <SortHeader label="Msgs" k="thread_id" />
              {descriptors.map(desc => (
                <SortHeader
                  key={desc.id}
                  label={desc.name}
                  k={desc.type === 'built-in' ? (desc.primaryField?.key ?? desc.id) : `custom_${desc.id}`}
                />
              ))}
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
                  descriptors={descriptors}
                  totalCols={totalCols}
                  evaluatorDescriptors={evaluatorDescriptors}
                />
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="p-3">
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
  descriptors,
  totalCols,
  evaluatorDescriptors,
}: {
  evaluation: ThreadEvalRow;
  isExpanded: boolean;
  onToggle: () => void;
  descriptors: EvaluatorDescriptor[];
  totalCols: number;
  evaluatorDescriptors?: EvaluatorDescriptor[];
}) {
  const result = useMemo(() => unwrapSerializedDates(e.result), [e.result]);
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
        {descriptors.map(desc => {
          const { value, state } = getCellValue(e, desc);
          return (
            <td key={desc.id} className="px-2.5 py-2">
              {state === 'failed' ? (
                <StatusBadge status="failed" />
              ) : state === 'skipped' ? (
                <StatusBadge status="skipped" />
              ) : (
                <CellRenderer desc={desc} value={value} />
              )}
            </td>
          );
        })}
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
          <td colSpan={totalCols} className="p-0">
            <ExpandedContent evaluation={e} evaluatorDescriptors={evaluatorDescriptors} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedContent({ evaluation: e, evaluatorDescriptors }: { evaluation: ThreadEvalRow; evaluatorDescriptors?: EvaluatorDescriptor[] }) {
  const result = useMemo(() => unwrapSerializedDates(e.result), [e.result]);
  const messages = result?.thread?.messages ?? [];

  const errorMsg = result?.error;
  const hasFailed = result?.failed_evaluators;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Generic error banner — only for old data or outer-except errors (no structured failed_evaluators) */}
      {errorMsg && !hasFailed && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-[var(--surface-error)] border border-[var(--border-error)] text-sm">
          <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
          <span className="text-[var(--text-primary)]">
            <strong>Evaluation failed:</strong> {errorMsg}
          </span>
        </div>
      )}

      {messages.length > 0 && <CompactTranscript messages={messages} />}

      {/* --- Efficiency --- */}
      {result?.failed_evaluators?.efficiency ? (
        <EvalFailedSection label="Efficiency" errorMsg={result.failed_evaluators.efficiency} />
      ) : result?.efficiency_evaluation?.reasoning ? (
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
      ) : null}

      {/* --- Correctness --- */}
      {result?.failed_evaluators?.correctness ? (
        <EvalFailedSection label="Correctness" errorMsg={result.failed_evaluators.correctness} />
      ) : result?.correctness_evaluations?.length > 0 ? (() => {
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
      })() : null}

      {/* --- Intent --- */}
      {result?.failed_evaluators?.intent ? (
        <EvalFailedSection label="Intent" errorMsg={result.failed_evaluators.intent} />
      ) : result?.intent_evaluations?.length > 0 ? (
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
      ) : null}

      {/* --- Custom Evaluators --- */}
      {result?.custom_evaluations && Object.keys(result.custom_evaluations).length > 0 && (
        <CustomEvaluationsBlock evaluations={result.custom_evaluations} evaluatorDescriptors={evaluatorDescriptors} />
      )}
    </div>
  );
}

function CustomEvaluationsBlock({
  evaluations,
  evaluatorDescriptors,
}: {
  evaluations: Record<string, CustomEvaluationResult>;
  evaluatorDescriptors?: EvaluatorDescriptor[];
}) {
  const entries = Object.values(evaluations);
  const completed = entries.filter(e => e.status === "completed");
  const failed = entries.filter(e => e.status === "failed");

  return (
    <EvalSection
      title="Custom Evaluators"
      subtitle={`${entries.length} evaluator${entries.length !== 1 ? "s" : ""}${failed.length > 0 ? ` (${failed.length} failed)` : ""}`}
    >
      {completed.map((ce) => {
        const desc = evaluatorDescriptors?.find(d => d.id === ce.evaluator_id);
        return (
          <EvalCard key={ce.evaluator_id} accentColor={STATUS_COLORS.pass}>
            <EvalCardHeader>
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)] shrink-0" />
              <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {ce.evaluator_name}
              </span>
            </EvalCardHeader>
            {ce.output && desc?.outputSchema && desc.outputSchema.length > 0 ? (
              <OutputFieldRenderer
                schema={desc.outputSchema}
                output={ce.output}
                mode="inline"
              />
            ) : ce.output ? (
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
            ) : null}
          </EvalCard>
        );
      })}
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
