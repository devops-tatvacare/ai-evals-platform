import { AlertTriangle } from 'lucide-react';
import type { AdversarialResult, CanonicalAdversarialCase } from '@/types/evalRuns';
import { VerdictBadge } from '../index';
import { humanize } from '@/utils/evalFormatters';

interface Props {
  result: AdversarialResult;
  canonicalCase: CanonicalAdversarialCase | null;
  verdict: string | null;
  infraError: string | null;
}

export default function AdversarialOverviewTab({ result, canonicalCase, verdict, infraError }: Props) {
  const tc = result.test_case;
  const transcript = result.transcript;
  const isFailure = verdict == null;
  const contradictionTypes = canonicalCase?.derived.contradictionTypes ?? [];
  const goalVerdicts = canonicalCase?.judge.goalVerdicts ?? [];
  const simulator = canonicalCase?.facts.simulator;
  const transport = canonicalCase?.facts.transport;

  return (
    <div className="space-y-4 h-full px-4 pb-4">
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

      {canonicalCase?.derived.hasContradiction && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-warning)] border-[var(--border-warning)]">
          <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-[var(--text-primary)]">Contradiction detected:</span>{' '}
            <span className="text-[var(--text-secondary)]">{contradictionTypes.map(humanize).join(', ')}</span>
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
        {tc.goal_flow && tc.goal_flow.length > 0 && (
          <span className="text-xs text-[var(--text-muted)]">{tc.goal_flow.map(humanize).join(' → ')}</span>
        )}
      </div>

      {/* Test case details table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            <DetailRow label="Synthetic Input" value={tc.synthetic_input} />
            <DetailRow label="Expected Behavior" value={tc.expected_behavior} />
            {tc.goal_flow && tc.goal_flow.length > 0 && (
              <DetailRow label="Goal Flow" value={tc.goal_flow.map(humanize).join(' → ')} />
            )}
            {tc.active_traits && tc.active_traits.length > 0 && (
              <DetailRow label="Traits" value={tc.active_traits.map(humanize).join(', ')} />
            )}
            {tc.expected_challenges && tc.expected_challenges.length > 0 && (
              <DetailRow label="Expected Challenges" value={tc.expected_challenges.join(', ')} />
            )}
            {!isFailure && canonicalCase && (
              <DetailRow
                label="Judge Goal Status"
                value={
                  canonicalCase.judge.goalAchieved ? 'Achieved' : 'Failed'
                }
                suffix={
                  !canonicalCase.judge.goalAchieved && canonicalCase.judge.reasoning
                    ? canonicalCase.judge.reasoning
                    : undefined
                }
                suffixColor="var(--color-error)"
              />
            )}
          </tbody>
        </table>
      </div>

      {/* Failure modes */}
      {goalVerdicts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Goal Verdicts
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {goalVerdicts.map((goal) => (
              <span
                key={goal.goalId}
                className={`px-2 py-0.5 rounded text-xs font-medium border ${
                  goal.achieved
                    ? 'bg-[var(--surface-success)] border-[var(--border-success)] text-[var(--color-success)]'
                    : 'bg-[var(--surface-error)] border-[var(--border-error)] text-[var(--color-error)]'
                }`}
              >
                {humanize(goal.goalId)}: {goal.achieved ? 'Achieved' : 'Failed'}
              </span>
            ))}
          </div>
        </div>
      )}

      {(result.persona_tactic_summary?.tactics_attempted?.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Persona Tactics Attempted
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {(result.persona_tactic_summary?.tactics_attempted ?? []).map((tacticId) => {
              const landed = (result.persona_tactic_summary?.tactics_landed ?? []).includes(tacticId);
              return (
                <span
                  key={tacticId}
                  className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    landed
                      ? 'bg-[var(--surface-error)] border-[var(--border-error)] text-[var(--color-error)]'
                      : 'bg-[var(--surface-info)] border-[var(--border-info)] text-[var(--color-info-dark)]'
                  }`}
                  title={landed ? 'Attempted and triggered a rule violation' : 'Attempted, held'}
                >
                  {humanize(tacticId)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {!isFailure && (canonicalCase?.judge.failureModes.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Failure Modes ({canonicalCase!.judge.failureModes.length})
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {canonicalCase!.judge.failureModes.map((fm) => (
              <span
                key={fm}
                className="bg-[var(--surface-error)] border border-[var(--border-error)] text-[var(--color-error)] px-2 py-0.5 rounded text-xs font-medium"
              >
                {humanize(fm)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {!isFailure && canonicalCase?.judge.reasoning && (
        <div className="text-sm text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded-md px-3 py-2 border border-[var(--border-subtle)]">
          {canonicalCase.judge.reasoning}
        </div>
      )}

      {canonicalCase && (
        <div className="grid gap-4 lg:grid-cols-2">
          <DebugCard
            title="Simulator State"
            rows={[
              ['Goal Achieved', simulator?.goalAchieved ? 'Yes' : 'No'],
              ['Goals Completed', simulator?.goalsCompleted?.map(humanize).join(', ') || 'none'],
              ['Goals Abandoned', simulator?.goalsAbandoned?.map(humanize).join(', ') || 'none'],
              ['Stop Reason', simulator?.stopReason || 'n/a'],
              ['Failure Reason', simulator?.failureReason || transcript?.failure_reason || 'n/a'],
            ]}
          />
          <DebugCard
            title="Transport Facts"
            rows={[
              ['Infra Failure', canonicalCase.derived.isInfraFailure ? 'Yes' : 'No'],
              ['HTTP Error', transport?.hadHttpError ? 'Yes' : 'No'],
              ['Stream Error', transport?.hadStreamError ? 'Yes' : 'No'],
              ['Timeout', transport?.hadTimeout ? 'Yes' : 'No'],
              ['Partial Response', transport?.hadPartialResponse ? 'Yes' : 'No'],
              ['Stream Errors', transport?.streamErrors?.join(', ') || 'none'],
            ]}
          />
        </div>
      )}
    </div>
  );
}

function DebugCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
      <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{title}</p>
      <div className="mt-2 space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-[var(--text-muted)]">{label}</span>
            <span className="text-right text-[var(--text-primary)]">{value}</span>
          </div>
        ))}
      </div>
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
