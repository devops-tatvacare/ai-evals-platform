import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { EmptyState, Pagination } from "@/components/ui";
import type { ThreadEvalRow, EvaluatorDescriptor } from "@/types";
import VerdictBadge from "./VerdictBadge";
import { pct, normalizeLabel } from "@/utils/evalFormatters";
import { routes } from "@/config/routes";
import { cn } from "@/utils/cn";

interface Props {
  evaluations: ThreadEvalRow[];
  evaluatorDescriptors?: EvaluatorDescriptor[];
  /** Set of thread IDs that have been human-reviewed */
  reviewedThreadIds?: Set<string>;
  /** Map of threadId → attributeKey → reviewedValue for before→after chips on verdict cells */
  humanVerdicts?: Map<string, Map<string, string>>;
}

type SortDir = "asc" | "desc";
const PAGE_SIZE = 25;

const CORRECTNESS_RANK: Record<string, number> = {
  "PASS": 0, "NOT APPLICABLE": 1, "SOFT FAIL": 2, "HARD FAIL": 3, "CRITICAL": 4,
};

const EFFICIENCY_RANK: Record<string, number> = {
  "EFFICIENT": 0, "ACCEPTABLE": 1, "INCOMPLETE": 2, "FRICTION": 3, "BROKEN": 4,
};

const DEFAULT_DESCRIPTORS: EvaluatorDescriptor[] = [
  {
    id: 'intent',
    name: 'Judge Intent Acc',
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

function CellRenderer({ desc, value, humanVerdict }: { desc: EvaluatorDescriptor; value: unknown; humanVerdict?: string }) {
  if (value == null) return <span className="text-[var(--text-muted)]">{"\u2014"}</span>;

  switch (desc.primaryField?.format) {
    case 'percentage': {
      const num = Number(value);
      return <span className="text-sm font-medium">{pct(num)}</span>;
    }
    case 'verdict':
      return <VerdictBadge verdict={String(value)} humanVerdict={humanVerdict} category={desc.type === 'built-in' ? desc.id as 'correctness' | 'efficiency' | 'intent' : 'correctness'} />;
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

function getMsgCount(te: ThreadEvalRow): number {
  const r = te.result as unknown as Record<string, unknown> | undefined;
  const thread = r?.thread as { message_count?: number; messages?: unknown[] } | undefined;
  return thread?.message_count ?? (thread?.messages as unknown[])?.length ?? 0;
}

function SortHeader({ label, k, sortKey, sortDir, onToggle }: {
  label: string;
  k: string;
  sortKey: string;
  sortDir: SortDir;
  onToggle: (key: string) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      onClick={() => onToggle(k)}
      className={`text-left px-2.5 py-2 text-xs uppercase tracking-wider cursor-pointer select-none whitespace-nowrap border-b-2 border-[var(--border-subtle)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1 ${
        active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
      {active && <span className="ml-1 text-[0.6rem]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
    </th>
  );
}

export default function EvalTable({ evaluations, evaluatorDescriptors, reviewedThreadIds, humanVerdicts }: Props) {
  const descriptors = evaluatorDescriptors ?? DEFAULT_DESCRIPTORS;
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>("thread_id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const arr = [...evaluations];
    arr.sort((a, b) => {
      let cmp = 0;

      if (sortKey === "thread_id") {
        cmp = a.thread_id.localeCompare(b.thread_id);
      } else if (sortKey === "message_count") {
        cmp = getMsgCount(a) - getMsgCount(b);
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
          const customEvals = (result?.custom_evaluations ?? {}) as Record<string, Record<string, unknown>>;
          const ce = customEvals[evalId];
          if (!ce || ce.status !== 'completed' || !ce.output) return '';
          const desc = descriptors.find(d => d.id === evalId);
          const primaryKey = desc?.primaryField?.key;
          if (primaryKey) {
            const output = ce.output as Record<string, unknown>;
            const val = output[primaryKey];
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

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = totalPages > 0 ? Math.min(page, totalPages - 1) : 0;
  const paged = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSort(key: string) {
    setPage(0);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const totalCols = 2 + descriptors.length + 1 + (reviewedThreadIds ? 1 : 0);

  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
        <table className="w-full border-collapse bg-[var(--bg-primary)]">
          <thead className="sticky top-0 z-10 bg-[var(--bg-primary)]">
            <tr>
              <SortHeader label="Thread ID" k="thread_id" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <SortHeader label="Msgs" k="message_count" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              {descriptors.map(desc => (
                <SortHeader
                  key={desc.id}
                  label={desc.name}
                  k={desc.type === 'built-in' ? (desc.primaryField?.key ?? desc.id) : `custom_${desc.id}`}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
              ))}
              <SortHeader label="Completed" k="success_status" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              {reviewedThreadIds && (
                <th className="text-left px-2.5 py-2 text-xs uppercase tracking-wider whitespace-nowrap border-b-2 border-[var(--border-subtle)] text-[var(--text-secondary)]">
                  Human Review
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {paged.map((e) => (
              <tr
                key={e.id}
                onClick={() => navigate(routes.kaira.threadDetail(e.thread_id))}
                className={cn(
                  'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors',
                  reviewedThreadIds?.has(e.thread_id) && 'bg-[color-mix(in_srgb,var(--interactive-primary)_2.5%,transparent)]',
                )}
              >
                <td className="px-2.5 py-2 text-sm font-mono text-[var(--text-primary)]">
                  <Link
                    to={routes.kaira.threadDetail(e.thread_id)}
                    className="text-[var(--text-brand)] hover:underline"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    {e.thread_id}
                  </Link>
                </td>
                <td className="px-2.5 py-2 text-sm text-right text-[var(--text-secondary)]">
                  {getMsgCount(e)}
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
                        <CellRenderer desc={desc} value={value} humanVerdict={desc.primaryField?.key ? humanVerdicts?.get(e.thread_id)?.get(desc.primaryField.key) : undefined} />
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
                {reviewedThreadIds && (
                  <td className="px-2.5 py-2 text-[11px]">
                    {reviewedThreadIds.has(e.thread_id) ? (
                      <span className="font-semibold text-[var(--text-brand)]">Yes</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">No</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
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

      <Pagination page={safePage + 1} totalPages={totalPages} onPageChange={(p) => setPage(p - 1)} showCount totalItems={sorted.length} pageSize={PAGE_SIZE} className="mt-1.5" />
    </div>
  );
}
