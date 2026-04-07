import { extractMetricFields } from '@/features/evals/utils/evaluatorMetadata';
import type { EvalRun, EvaluatorDefinition } from '@/types';

interface EvaluatorExpandRowProps {
  evaluator: EvaluatorDefinition;
  latestRun?: EvalRun;
}

export function EvaluatorExpandRow({
  evaluator,
  latestRun,
}: EvaluatorExpandRowProps) {
  const metricFields = extractMetricFields(evaluator, latestRun);

  if (metricFields.length === 0) {
    const statusText = !latestRun
      ? 'No runs yet — click Run to evaluate.'
      : latestRun.status === 'running'
        ? 'Evaluation in progress...'
        : latestRun.status === 'failed'
          ? latestRun.errorMessage || 'Latest run failed.'
          : 'No metric fields in this evaluator.';

    return (
      <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 px-4 py-3">
        <p className="text-sm text-[var(--text-muted)]">{statusText}</p>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 p-4">
      <div className="flex flex-wrap gap-2">
        {metricFields.map(({ key, label, value, type }) => (
          <div
            key={key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 min-w-[120px]"
          >
            <span className="text-[11px] font-medium text-[var(--text-muted)] block truncate">{label}</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {type === 'number' && typeof value === 'number' ? value.toFixed(2) : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
