import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import type { AdversarialEvalRow } from "@/types";
import { fetchRunAdversarial } from "@/services/api/evalRunsApi";
import { VerdictBadge, TranscriptViewer, RuleComplianceGrid } from "../components";
import { CATEGORY_COLORS } from "@/utils/evalColors";
import { humanize } from "@/utils/evalFormatters";

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

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-[0.8rem] text-red-700">
        {error}
      </div>
    );
  }

  if (!evalItem) {
    return <div className="text-[0.8rem] text-slate-400 text-center py-8">Loading...</div>;
  }

  const result = evalItem.result;
  const tc = result.test_case;
  const transcript = result.transcript;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-[0.78rem] text-slate-400">
        <Link to="/kaira/runs" className="hover:text-indigo-600">Runs</Link>
        <span>/</span>
        <Link to={`/kaira/runs/${runId}`} className="hover:text-indigo-600 font-mono">
          {runId?.slice(0, 12)}
        </Link>
        <span>/</span>
        <span className="text-slate-600">Adversarial Test</span>
      </div>

      <div
        className="bg-white border border-slate-200 rounded-md px-4 py-3"
        style={{
          borderLeftWidth: 4,
          borderLeftColor: CATEGORY_COLORS[tc.category] ?? "#6b7280",
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-slate-800">
              {humanize(tc.category)}
            </h1>
            <VerdictBadge verdict={tc.difficulty} category="difficulty" />
          </div>
          <VerdictBadge verdict={result.verdict} category="adversarial" size="md" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 bg-slate-50/60 border border-slate-100 rounded p-2.5 text-[0.8rem]">
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-slate-400 font-semibold">
              Synthetic Input
            </p>
            <p className="mt-px text-slate-700">{tc.synthetic_input}</p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-slate-400 font-semibold">
              Expected Behavior
            </p>
            <p className="mt-px text-slate-700">{tc.expected_behavior}</p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-slate-400 font-semibold">
              Goal Type
            </p>
            <p className="mt-px text-slate-700">{tc.goal_type}</p>
          </div>
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-slate-400 font-semibold">
              Goal Achieved
            </p>
            <p className="mt-px text-slate-700">
              {transcript.goal_achieved ? "Yes" : "No"}
              {!transcript.goal_achieved && transcript.abandonment_reason && (
                <span className="text-red-600 ml-1">
                  ({transcript.abandonment_reason})
                </span>
              )}
            </p>
          </div>
        </div>

        {result.failure_modes.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-2">
            {result.failure_modes.map((fm, i) => (
              <span
                key={i}
                className="bg-red-50 border border-red-100 text-red-700 px-1.5 py-px rounded text-[0.68rem] font-medium"
              >
                {fm}
              </span>
            ))}
          </div>
        )}

        {result.reasoning && (
          <div className="mt-2">
            <p className="text-[0.65rem] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">
              Reasoning
            </p>
            <p className="text-[0.8rem] text-slate-600">{result.reasoning}</p>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Conversation Transcript ({transcript.total_turns} turns)
        </h2>
        <TranscriptViewer turns={transcript.turns} />
      </div>

      {result.rule_compliance.length > 0 && (
        <div>
          <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
            Rule Compliance
          </h2>
          <RuleComplianceGrid rules={result.rule_compliance} />
        </div>
      )}
    </div>
  );
}
