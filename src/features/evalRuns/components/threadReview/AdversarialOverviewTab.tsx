import { AlertTriangle } from 'lucide-react';
import type { AdversarialResult } from '@/types/evalRuns';
import { VerdictBadge } from '../index';
import { humanize } from '@/utils/evalFormatters';

interface Props {
  result: AdversarialResult;
  verdict: string | null;
  infraError: string | null;
}

export default function AdversarialOverviewTab({ result, verdict, infraError }: Props) {
  const tc = result.test_case;
  const transcript = result.transcript;
  const isFailure = verdict == null;

  return (
    <div className="space-y-4 overflow-y-auto h-full px-4 pb-4">
      {/* Infra error banner */}
      {isFailure && infraError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-error)] border-[var(--border-error)]">
          <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[var(--text-primary)]">Infrastructure Error:</span>{' '}
            <span className="text-[var(--text-secondary)]">{infraError}</span>
          </div>
        </div>
      )}

      {/* Verdict + difficulty header */}
      <div className="flex flex-wrap items-center gap-2">
        {verdict ? (
          <VerdictBadge verdict={verdict} category="adversarial" size="md" />
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-error)] text-white">
            Failed
          </span>
        )}
        <VerdictBadge verdict={tc.difficulty} category="difficulty" size="md" />
        <span className="text-xs text-[var(--text-muted)]">{humanize(tc.category)}</span>
      </div>

      {/* Test case details table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            <DetailRow label="Synthetic Input" value={tc.synthetic_input} />
            <DetailRow label="Expected Behavior" value={tc.expected_behavior} />
            <DetailRow label="Goal Type" value={tc.goal_type} />
            {!isFailure && transcript && (
              <DetailRow
                label="Goal Achieved"
                value={
                  transcript.goal_achieved ? 'Yes' : 'No'
                }
                suffix={
                  !transcript.goal_achieved && (transcript.failure_reason || transcript.abandonment_reason)
                    ? (transcript.failure_reason || transcript.abandonment_reason)
                    : undefined
                }
                suffixColor="var(--color-error)"
              />
            )}
          </tbody>
        </table>
      </div>

      {/* Failure modes */}
      {!isFailure && (result.failure_modes?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Failure Modes ({result.failure_modes!.length})
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {result.failure_modes!.map((fm, i) => (
              <span
                key={i}
                className="bg-[var(--surface-error)] border border-[var(--border-error)] text-[var(--color-error)] px-2 py-0.5 rounded text-xs font-medium"
              >
                {fm}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {!isFailure && result.reasoning && (
        <div className="text-sm text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-md px-3 py-2 border border-[var(--border-subtle)]">
          {result.reasoning}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  suffix,
  suffixColor,
}: {
  label: string;
  value: string;
  suffix?: string;
  suffixColor?: string;
}) {
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      <td className="py-1.5 pr-3 text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold whitespace-nowrap align-top w-40">
        {label}
      </td>
      <td className="py-1.5 text-[var(--text-primary)]">
        {value}
        {suffix && (
          <span className="ml-1.5 text-xs" style={{ color: suffixColor }}>
            ({suffix})
          </span>
        )}
      </td>
    </tr>
  );
}
