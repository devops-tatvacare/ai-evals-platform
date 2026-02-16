import { useState, useEffect } from "react";
import type { SummaryStats, TrendEntry, Run } from "@/types";
import { fetchStats, fetchTrends, fetchRuns } from "@/services/api/evalRunsApi";
import { RunCard, TrendChart, DistributionBar, MetricInfo } from "../components";
import { CORRECTNESS_ORDER, EFFICIENCY_ORDER, INTENT_ORDER } from "@/utils/evalColors";

function StatCard({ label, value, metricKey }: { label: string; value: string | number; metricKey?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded px-4 py-3">
      <div className="flex items-center gap-1">
        <p className="text-[0.65rem] uppercase tracking-wider text-slate-400 font-semibold">
          {label}
        </p>
        {metricKey && <MetricInfo metricKey={metricKey} size={12} />}
      </div>
      <p className="text-xl font-extrabold text-slate-800 mt-0.5 leading-tight">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [trends, setTrends] = useState<TrendEntry[]>([]);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchStats(), fetchTrends(30), fetchRuns({ limit: 5 })])
      .then(([s, t, r]) => {
        setStats(s);
        setTrends(t.data);
        setRecentRuns(r.runs);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-[0.8rem] text-red-700">
        Failed to load dashboard data: {error}
        <p className="mt-1 text-red-500">
          Failed to load dashboard data. Make sure the backend is running.
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-48 text-[0.8rem] text-slate-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-bold text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Runs" metricKey="total_runs" value={stats.total_runs} />
        <StatCard label="Threads Evaluated" metricKey="threads_evaluated" value={stats.total_threads_evaluated} />
        <StatCard label="Adversarial Tests" metricKey="adversarial_tests" value={stats.total_adversarial_tests} />
        {stats.avg_intent_accuracy != null && (
          <StatCard
            label="Avg Intent Accuracy"
            metricKey="avg_intent_acc"
            value={`${(stats.avg_intent_accuracy * 100).toFixed(1)}%`}
          />
        )}
        {stats.avg_intent_accuracy == null && (
          <StatCard
            label="Last Run"
            value={recentRuns.length > 0 ? recentRuns[0]!.command : "\u2014"}
          />
        )}
      </div>

      <div className="flex gap-4 flex-wrap">
        {Object.keys(stats.correctness_distribution).length > 0 && (
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
              Correctness
            </h2>
            <DistributionBar
              distribution={stats.correctness_distribution}
              order={CORRECTNESS_ORDER}
            />
          </div>
        )}
        {Object.keys(stats.efficiency_distribution).length > 0 && (
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
              Efficiency
            </h2>
            <DistributionBar
              distribution={stats.efficiency_distribution}
              order={EFFICIENCY_ORDER}
            />
          </div>
        )}
        {Object.keys(stats.intent_distribution).length > 0 && (
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
              Intent Classification
            </h2>
            <DistributionBar
              distribution={stats.intent_distribution}
              order={INTENT_ORDER}
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Verdict Trend (30 days)
        </h2>
        <TrendChart data={trends} />
      </div>

      <div>
        <h2 className="text-[0.72rem] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Recent Runs
        </h2>
        <div className="space-y-1.5">
          {recentRuns.map((run) => (
            <RunCard key={run.run_id} run={run} />
          ))}
          {recentRuns.length === 0 && (
            <p className="text-[0.8rem] text-slate-400 py-4 text-center">
              No runs yet. Run an evaluation with the CLI to see results here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
