import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GitCompare, Loader2 } from 'lucide-react';

import { Card, Combobox } from '@/components/ui';
import type { AdversarialEvalRow, EvalRun } from '@/types';
import { fetchEvalRuns, fetchRunAdversarial } from '@/services/api/evalRunsApi';
import { humanize, pct } from '@/utils/evalFormatters';
import { getCanonicalAdversarialCase } from '../utils/adversarialCanonical';

interface Props {
  currentRunId: string;
  currentRunName?: string | null;
  currentRunCreatedAt?: string | null;
  currentEvaluations: AdversarialEvalRow[];
}

interface MetricSnapshot {
  passRate: number | null;
  goalRate: number | null;
  errorRate: number;
  avgTurns: number | null;
}

function computeMetrics(evaluations: AdversarialEvalRow[]): MetricSnapshot {
  const canonical = evaluations.map((evaluation) => getCanonicalAdversarialCase(evaluation.result, evaluation));
  const successful = canonical.filter((caseRecord) => !caseRecord.derived.isInfraFailure);
  const errors = canonical.filter((caseRecord) => caseRecord.derived.isInfraFailure).length;
  return {
    passRate:
      successful.length > 0
        ? successful.filter((caseRecord) => caseRecord.judge.verdict === 'PASS').length / successful.length
        : null,
    goalRate:
      successful.length > 0
        ? successful.filter((caseRecord) => caseRecord.judge.goalAchieved).length / successful.length
        : null,
    errorRate: evaluations.length > 0 ? errors / evaluations.length : 0,
    avgTurns:
      evaluations.length > 0
        ? canonical.reduce((sum, caseRecord) => sum + caseRecord.facts.transcript.turnCount, 0) / evaluations.length
        : null,
  };
}

function computeGoalPassRates(evaluations: AdversarialEvalRow[]): Record<string, number> {
  const grouped: Record<string, { total: number; passed: number }> = {};
  evaluations.forEach((evaluation) => {
    const canonical = getCanonicalAdversarialCase(evaluation.result, evaluation);
    canonical.judge.goalVerdicts.forEach((goalVerdict) => {
      const goalId = goalVerdict.goalId || 'unknown';
      grouped[goalId] = grouped[goalId] || { total: 0, passed: 0 };
      grouped[goalId].total += 1;
      if (goalVerdict.achieved) {
        grouped[goalId].passed += 1;
      }
    });
  });
  return Object.fromEntries(
    Object.entries(grouped).map(([goal, values]) => [
      goal,
      values.total > 0 ? values.passed / values.total : 0,
    ]),
  );
}

function formatMetricValue(value: number | null, mode: 'percent' | 'number'): string {
  if (value == null) return '—';
  if (mode === 'percent') return pct(value);
  return value.toFixed(1);
}

function formatDeltaValue(value: number | null, mode: 'percent' | 'number'): string {
  if (value == null) return '—';
  if (mode === 'percent') {
    return `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(1)}%`;
  }
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
}

export function AdversarialComparisonPanel({
  currentRunId,
  currentRunName,
  currentRunCreatedAt,
  currentEvaluations,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [baselineRuns, setBaselineRuns] = useState<EvalRun[]>([]);
  const [selectedBaselineRunId, setSelectedBaselineRunId] = useState('');
  const [baselineEvaluations, setBaselineEvaluations] = useState<AdversarialEvalRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingRuns(true);
    fetchEvalRuns({ app_id: 'kaira-bot', eval_type: 'batch_adversarial', limit: 200 })
      .then((runs) => {
        if (cancelled) return;
        const filtered = runs
          .filter((run) => run.id !== currentRunId)
          .filter((run) => ['completed', 'completed_with_errors'].includes(run.status))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setBaselineRuns(filtered);
        if (filtered.length > 0) {
          const preferred = filtered.find((run) => {
            if (!currentRunCreatedAt || !run.createdAt) return false;
            return new Date(run.createdAt).getTime() < new Date(currentRunCreatedAt).getTime();
          });
          setSelectedBaselineRunId(preferred?.id || filtered[0].id);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRuns(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentRunCreatedAt, currentRunId]);

  useEffect(() => {
    if (!selectedBaselineRunId) {
      setBaselineEvaluations([]);
      return;
    }
    let cancelled = false;
    setLoadingBaseline(true);
    fetchRunAdversarial(selectedBaselineRunId)
      .then((response) => {
        if (!cancelled) {
          setBaselineEvaluations(response.evaluations);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBaseline(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBaselineRunId]);

  const baselineOptions = useMemo(
    () =>
      baselineRuns.map((run) => ({
        value: run.id,
        label: `${run.name || run.command || 'Adversarial Run'} · ${new Date(run.createdAt).toLocaleString()}`,
        searchText: `${run.id} ${run.name || ''} ${run.command || ''} ${run.createdAt}`,
      })),
    [baselineRuns],
  );

  const currentMetrics = useMemo(
    () => computeMetrics(currentEvaluations),
    [currentEvaluations],
  );
  const baselineMetrics = useMemo(
    () => computeMetrics(baselineEvaluations),
    [baselineEvaluations],
  );

  const currentGoalRates = useMemo(
    () => computeGoalPassRates(currentEvaluations),
    [currentEvaluations],
  );
  const baselineGoalRates = useMemo(
    () => computeGoalPassRates(baselineEvaluations),
    [baselineEvaluations],
  );

  const goalRows = useMemo(() => {
    const goals = new Set([
      ...Object.keys(currentGoalRates),
      ...Object.keys(baselineGoalRates),
    ]);
    return Array.from(goals)
      .sort()
      .map((goal) => ({
        goal,
        current: currentGoalRates[goal] ?? null,
        baseline: baselineGoalRates[goal] ?? null,
      }));
  }, [baselineGoalRates, currentGoalRates]);

  const selectedBaselineLabel = useMemo(() => {
    if (loadingRuns) return 'Loading baseline runs...';
    if (baselineOptions.length === 0) return 'No other adversarial runs available yet.';
    return baselineRuns.find((run) => run.id === selectedBaselineRunId)?.name
      || baselineOptions.find((option) => option.value === selectedBaselineRunId)?.label
      || 'Select baseline run';
  }, [baselineOptions, baselineRuns, loadingRuns, selectedBaselineRunId]);

  return (
    <Card className="space-y-4" hoverable={false}>
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2">
          <GitCompare className="mt-0.5 h-4 w-4 text-[var(--text-brand)]" />
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Compare Against Baseline
            </h3>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              {selectedBaselineLabel}
            </p>
          </div>
        </div>
        <span className="mt-0.5 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1 text-[var(--text-muted)]">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {isExpanded && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-[var(--text-primary)]">Current Run</p>
              <div className="flex-1 flex items-center rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
                <div>
                  <p className="text-[12px] font-semibold text-[var(--text-primary)]">{currentRunName || 'Current adversarial run'}</p>
                  {currentRunCreatedAt && <p className="text-[11px] text-[var(--text-muted)]">{new Date(currentRunCreatedAt).toLocaleDateString()}</p>}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-medium text-[var(--text-primary)]">Baseline Run</p>
              {loadingRuns ? (
                <div className="flex-1 flex items-center gap-2 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading past runs...
                </div>
              ) : baselineOptions.length === 0 ? (
                <div className="flex-1 flex items-center rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
                  No other adversarial runs available yet.
                </div>
              ) : (
                <Combobox
                  value={selectedBaselineRunId}
                  onChange={setSelectedBaselineRunId}
                  options={baselineOptions}
                  placeholder="Select a baseline run"
                />
              )}
            </div>
          </div>

          {selectedBaselineRunId && (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <DeltaMetric
                  label="Pass Rate"
                  mode="percent"
                  current={formatMetricValue(currentMetrics.passRate, 'percent')}
                  baseline={formatMetricValue(baselineMetrics.passRate, 'percent')}
                  delta={
                    currentMetrics.passRate != null && baselineMetrics.passRate != null
                      ? currentMetrics.passRate - baselineMetrics.passRate
                      : null
                  }
                  improveWhenPositive
                />
                <DeltaMetric
                  label="Goal Achievement"
                  mode="percent"
                  current={formatMetricValue(currentMetrics.goalRate, 'percent')}
                  baseline={formatMetricValue(baselineMetrics.goalRate, 'percent')}
                  delta={
                    currentMetrics.goalRate != null && baselineMetrics.goalRate != null
                      ? currentMetrics.goalRate - baselineMetrics.goalRate
                      : null
                  }
                  improveWhenPositive
                />
                <DeltaMetric
                  label="Infra Error Rate"
                  mode="percent"
                  current={formatMetricValue(currentMetrics.errorRate, 'percent')}
                  baseline={formatMetricValue(baselineMetrics.errorRate, 'percent')}
                  delta={currentMetrics.errorRate - baselineMetrics.errorRate}
                  improveWhenPositive={false}
                />
                <DeltaMetric
                  label="Avg Turns"
                  mode="number"
                  current={formatMetricValue(currentMetrics.avgTurns, 'number')}
                  baseline={formatMetricValue(baselineMetrics.avgTurns, 'number')}
                  delta={
                    currentMetrics.avgTurns != null && baselineMetrics.avgTurns != null
                      ? currentMetrics.avgTurns - baselineMetrics.avgTurns
                      : null
                  }
                  improveWhenPositive={false}
                />
              </div>

              <div className="rounded-[6px] border border-[var(--border-subtle)] overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_90px] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  <span>Goal</span>
                  <span>Baseline</span>
                  <span>Current</span>
                  <span>Delta</span>
                </div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {loadingBaseline ? (
                    <div className="px-3 py-3 text-[12px] text-[var(--text-muted)]">
                      Loading baseline results...
                    </div>
                  ) : goalRows.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-[var(--text-muted)]">
                      No comparable goal data yet.
                    </div>
                  ) : (
                    goalRows.map((row) => {
                      const delta =
                        row.current != null && row.baseline != null
                          ? row.current - row.baseline
                          : null;
                      return (
                        <div
                          key={row.goal}
                          className="grid grid-cols-[minmax(0,1fr)_110px_110px_90px] items-center px-3 py-2 text-[12px]"
                        >
                          <span className="font-medium text-[var(--text-primary)]">
                            {humanize(row.goal)}
                          </span>
                          <span className="text-[var(--text-secondary)]">
                            {formatMetricValue(row.baseline, 'percent')}
                          </span>
                          <span className="text-[var(--text-secondary)]">
                            {formatMetricValue(row.current, 'percent')}
                          </span>
                          <span className={delta == null ? 'text-[var(--text-muted)]' : delta >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}>
                            {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}


function DeltaMetric({
  label,
  current,
  baseline,
  delta,
  mode,
  improveWhenPositive,
}: {
  label: string;
  current: string;
  baseline: string;
  delta: number | null;
  mode: 'percent' | 'number';
  improveWhenPositive: boolean;
}) {
  const isImproved =
    delta == null ? null : improveWhenPositive ? delta >= 0 : delta <= 0;
  const deltaText = formatDeltaValue(delta, mode);

  return (
    <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div>
          <p className="text-[16px] font-semibold text-[var(--text-primary)]">{current}</p>
          <p className="text-[11px] text-[var(--text-muted)]">Baseline {baseline}</p>
        </div>
        <div
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            isImproved == null
              ? 'bg-[var(--bg-primary)] text-[var(--text-muted)]'
              : isImproved
                ? 'bg-[var(--surface-success)] text-[var(--color-success)]'
                : 'bg-[var(--surface-error)] text-[var(--color-error)]'
          }`}
        >
          {isImproved == null ? null : isImproved ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {deltaText}
        </div>
      </div>
    </div>
  );
}
