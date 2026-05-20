import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { StatPill, DistributionBar } from '@/features/evalRuns/components';
import { useReviewTableData, getEffectiveAttribute } from '@/features/reviews/inline';
import { getCanonicalAdversarialCase } from '@/features/evalRuns/utils/adversarialCanonical';
import AdversarialTable from '@/features/evalRuns/components/AdversarialTable';
import { pct, normalizeLabel } from '@/utils/evalFormatters';
import type { Run, AdversarialEvalRow } from '@/types';

export interface BatchAdversarialResultsProps {
  run: Run;
  adversarialEvals: AdversarialEvalRow[];
  isRunActive: boolean;
}

export function BatchAdversarialResults({ run, adversarialEvals, isRunActive }: BatchAdversarialResultsProps) {
  const adversarialDist = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const ae of adversarialEvals) {
      if (ae.verdict != null) {
        const n = normalizeLabel(ae.verdict);
        dist[n] = (dist[n] ?? 0) + 1;
      }
    }
    return dist;
  }, [adversarialEvals]);

  return (
    <AdversarialSection
      evals={adversarialEvals}
      adversarialDist={adversarialDist}
      run={run}
      isRunActive={isRunActive}
    />
  );
}

function AdversarialErrorBanner({ errors, total }: { errors: number; total: number }) {
  return (
    <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
      <span className="text-sm text-[var(--color-warning)] font-medium">
        {errors} of {total} test{total !== 1 ? 's' : ''} failed due to API errors (rate limits, timeouts, etc.). Pass rate and goal achievement exclude errored tests.
      </span>
    </div>
  );
}

function AdversarialSection({ evals, adversarialDist, run, isRunActive }: {
  evals: AdversarialEvalRow[];
  adversarialDist: Record<string, number>;
  run: Run;
  isRunActive: boolean;
}) {
  const { humanVerdicts } = useReviewTableData(run.run_id, { itemType: 'adversarial' });
  const canonicalCases = evals.map((evaluation) => ({
    evaluation,
    canonical: getCanonicalAdversarialCase(evaluation.result, evaluation),
  }));
  const infraCount = canonicalCases.filter(({ canonical }) => canonical.derived.isInfraFailure).length;
  const evaluatedCases = canonicalCases.filter(({ canonical }) => !canonical.derived.isInfraFailure);
  const successfulCount = evaluatedCases.length;
  const passRate = successfulCount > 0
    ? evaluatedCases.filter(({ canonical }) => canonical.judge.verdict === 'PASS').length / successfulCount
    : null;
  const goalRate = successfulCount > 0
    ? evaluatedCases.filter(({ canonical }) => canonical.judge.goalAchieved).length / successfulCount
    : null;
  const avgTurns = evals.length > 0
    ? canonicalCases.reduce((sum, { canonical, evaluation }) => sum + (canonical.facts.transcript.turnCount || evaluation.total_turns), 0) / evals.length
    : null;

  const reviewedPassRate = useMemo(() => {
    if (!humanVerdicts || humanVerdicts.size === 0 || successfulCount === 0) return null;
    let hits = 0;
    for (const { canonical, evaluation } of evaluatedCases) {
      const verdict = getEffectiveAttribute(humanVerdicts, String(evaluation.id), 'verdict', canonical.judge.verdict);
      if (verdict === 'PASS') hits += 1;
    }
    return hits / successfulCount;
  }, [humanVerdicts, evaluatedCases, successfulCount]);

  const reviewedAdversarialDist = useMemo(() => {
    if (!humanVerdicts || humanVerdicts.size === 0) return null;
    const dist: Record<string, number> = {};
    for (const { canonical, evaluation } of evaluatedCases) {
      const verdict = getEffectiveAttribute(humanVerdicts, String(evaluation.id), 'verdict', canonical.judge.verdict) ?? 'UNKNOWN';
      dist[verdict] = (dist[verdict] ?? 0) + 1;
    }
    return dist;
  }, [humanVerdicts, evaluatedCases]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        {infraCount > 0 && !isRunActive && <AdversarialErrorBanner errors={infraCount} total={evals.length} />}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatPill label="Tests" metricKey="total_tests" value={evals.length} />
          <StatPill
            label="Pass Rate"
            metricKey="pass_rate"
            value={passRate != null ? pct(passRate) : 'N/A'}
            humanValue={reviewedPassRate != null ? pct(reviewedPassRate) : undefined}
          />
          <StatPill label="Goal Achievement" metricKey="goal_achievement" value={goalRate != null ? pct(goalRate) : 'N/A'} />
          <StatPill label="Infra Error Rate" value={pct(evals.length > 0 ? infraCount / evals.length : 0)} color={infraCount > 0 ? 'var(--color-error)' : undefined} />
          <StatPill label="Avg Turns" metricKey="avg_turns" value={avgTurns != null ? avgTurns.toFixed(1) : 'N/A'} />
        </div>

        {Object.keys(adversarialDist).length > 0 && (
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">Verdicts</h3>
              {reviewedAdversarialDist && (
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-brand)] font-semibold">Reviewed</span>
              )}
            </div>
            {reviewedAdversarialDist ? (
              <div className="space-y-2">
                <div className="opacity-60">
                  <p className="text-[10px] text-[var(--text-muted)] mb-0.5">AI</p>
                  <DistributionBar distribution={adversarialDist} />
                </div>
                <div>
                  <p className="text-[10px] text-[var(--text-brand)] mb-0.5">Reviewed</p>
                  <DistributionBar distribution={reviewedAdversarialDist} />
                </div>
              </div>
            ) : (
              <DistributionBar distribution={adversarialDist} />
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <ReviewAwareAdversarialTable evaluations={evals} runId={run.run_id} />
      </div>
    </div>
  );
}

function ReviewAwareAdversarialTable({ evaluations, runId }: { evaluations: AdversarialEvalRow[]; runId: string }) {
  const { reviewableItems, reviewedIds, humanVerdicts } = useReviewTableData(runId, { itemType: 'adversarial' });
  return (
    <AdversarialTable
      evaluations={evaluations}
      runId={runId}
      reviewableItems={reviewableItems}
      reviewedIds={reviewedIds}
      humanVerdicts={humanVerdicts}
    />
  );
}
