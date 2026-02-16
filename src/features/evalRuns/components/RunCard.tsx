import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { Run } from "@/types";
import VerdictBadge from "./VerdictBadge";
import { timeAgo, formatDuration } from "@/utils/evalFormatters";

interface Props {
  run: Run;
  onDelete?: (runId: string) => void;
}

export default function RunCard({ run, onDelete }: Props) {
  const [deleting, setDeleting] = useState(false);
  const summary = run.summary ?? {};
  const totalItems =
    (summary.total_threads as number) ??
    (summary.total_tests as number) ??
    run.total_items ??
    0;
  const itemLabel = run.command === "adversarial" ? "tests" : "threads";

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onDelete) return;
    if (!window.confirm(`Delete run ${run.run_id.slice(0, 12)}… and all its evaluations?`)) return;
    setDeleting(true);
    onDelete(run.run_id);
  }

  return (
    <Link
      to={`/kaira/runs/${run.run_id}`}
      className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded px-3 py-2.5 hover:border-indigo-200 transition-colors"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[0.68rem] font-mono text-slate-400 shrink-0">
          {run.run_id.slice(0, 8)}
        </span>
        <span className="font-semibold text-[0.82rem] text-slate-800">
          {run.command}
        </span>
        <span className="text-[0.72rem] text-slate-400">
          {totalItems} {itemLabel}
        </span>
        {run.llm_model && (
          <span className="text-[0.68rem] text-slate-300 hidden md:inline">
            {run.llm_provider}/{run.llm_model}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[0.7rem] text-slate-400">
          {formatDuration(run.duration_seconds)}
        </span>
        <span className="text-[0.7rem] text-slate-400">{timeAgo(run.timestamp)}</span>
        <VerdictBadge verdict={run.status} category="status" />
        {onDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
            title="Delete run"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </Link>
  );
}
