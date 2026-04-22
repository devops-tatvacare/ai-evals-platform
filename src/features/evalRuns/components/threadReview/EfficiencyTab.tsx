import { AlertTriangle } from 'lucide-react';
import type { EfficiencyEvaluation, RuleCompliance } from '@/types/evalRuns';
import VerdictBadge from '../VerdictBadge';
import { STATUS_COLORS } from '@/utils/statusColors';
import {
  getRuleOutcomeMeta,
  getRuleOutcomeStatus,
  sortRuleOutcomes,
  summarizeRuleOutcomes,
} from '../../utils/ruleCompliance';

interface Props {
  evaluation: EfficiencyEvaluation | null;
  failed?: string;
  skipped?: boolean;
}

export default function EfficiencyTab({ evaluation, failed, skipped }: Props) {
  if (failed) {
    return <EvalFailedBanner label="Efficiency" errorMsg={failed} />;
  }

  if (skipped) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-sm text-[var(--text-muted)]">
          Efficiency evaluation was skipped for this run.
        </p>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="flex h-full items-center justify-center text-center">
        <p className="text-sm text-[var(--text-muted)]">
          No efficiency evaluation available.
        </p>
      </div>
    );
  }

  const ee = evaluation;
  const allRules = sortRuleOutcomes(ee.rule_compliance ?? []);
  const summary = summarizeRuleOutcomes(allRules);

  return (
    <div className="space-y-4 h-full px-4 pb-4">
      {/* ── Summary card: badges + reasoning + failure reason ── */}
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden">
        {/* Badge row */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <VerdictBadge verdict={ee.verdict} category="efficiency" size="md" />
          <VerdictBadge verdict={ee.recovery_quality} category="recovery" size="md" />
          <VerdictBadge verdict={ee.task_completed ? 'COMPLETED' : 'NOT COMPLETED'} category="task_completion" size="md" />
        </div>

        {/* Reasoning */}
        {ee.reasoning && (
          <div className="text-sm text-[var(--text-secondary)] px-3 pb-2.5 border-t border-[var(--border-subtle)] pt-2">
            {ee.reasoning}
          </div>
        )}

        {/* Failure reason (reads new field, falls back to old for pre-migration records) */}
        {(ee.failure_reason || ee.abandonment_reason) && (
          <div className="text-sm px-3 pb-2.5 border-t pt-2" style={{ borderColor: STATUS_COLORS.hardFail, backgroundColor: 'var(--surface-error)' }}>
            <p className="text-[10px] uppercase tracking-wider text-[var(--color-error)] font-semibold mb-0.5">
              Failure Reason
            </p>
            <p className="text-[var(--text-primary)]">{ee.failure_reason || ee.abandonment_reason}</p>
          </div>
        )}
      </div>

      {/* ── Tables: friction turns, rule compliance ── */}

      {/* Friction turns */}
      {ee.friction_turns?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Friction Turns ({ee.friction_turns.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-10">#</th>
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-16">Turn</th>
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-16">Cause</th>
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {ee.friction_turns.map((ft, i) => {
                  const isBot = (ft.cause ?? '').toUpperCase() === 'BOT';
                  return (
                    <tr
                      key={i}
                      className={`border-b border-[var(--border-subtle)] ${
                        isBot ? 'bg-[var(--surface-warning)]' : ''
                      }`}
                    >
                      <td className="py-1.5 px-2 text-[var(--text-muted)] font-mono text-xs">{i + 1}</td>
                      <td className="py-1.5 px-2 font-semibold text-[var(--text-primary)]">
                        {ft.turn ?? '?'}
                      </td>
                      <td className="py-1.5 px-2">
                        <span
                          className={`inline-block px-1.5 py-px rounded text-[0.6rem] font-bold uppercase text-white ${
                            isBot ? 'bg-[var(--color-warning)]' : 'bg-[var(--text-muted)]'
                          }`}
                        >
                          {ft.cause ?? '?'}
                        </span>
                      </td>
                      <td className={`py-1.5 px-2 ${isBot ? 'text-[var(--color-warning)]' : 'text-[var(--text-secondary)]'}`}>
                        {ft.description || '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rule compliance */}
      {allRules.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Rule Compliance
            <span className="ml-1.5 normal-case tracking-normal font-normal">
              {`\u2014 ${summary}`}
            </span>
          </p>
          <div className="overflow-x-auto pb-1">
            <table className="w-full text-sm" style={{ minWidth: 900 }}>
              <colgroup>
                <col style={{ width: '4rem' }} />
                <col style={{ width: '16rem' }} />
                <col style={{ width: '18rem' }} />
                <col style={{ width: '24rem' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="text-center text-xs text-[var(--text-muted)] font-semibold py-1.5 px-3 whitespace-nowrap">Status</th>
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-3 whitespace-nowrap">Rule ID</th>
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-3 whitespace-nowrap">Section in Kaira Prompt</th>
                  <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-3 whitespace-nowrap">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {allRules.map((rule, i) => (
                  <RuleRow key={`${rule.rule_id}-${i}`} rule={rule} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({ rule }: { rule: RuleCompliance }) {
  const status = getRuleOutcomeStatus(rule);
  const meta = getRuleOutcomeMeta(status);
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      <td className="py-2.5 px-3 text-center align-top">
        <span className={`inline-flex items-center justify-center min-w-[96px] px-2 py-0.5 rounded-full text-[0.65rem] font-semibold ${meta.badgeClass}`}>
          {meta.label}
        </span>
      </td>
      <td className={`py-2.5 px-3 font-semibold whitespace-nowrap align-top ${meta.textClass}`}>
        {rule.rule_id}
      </td>
      <td className="py-2.5 px-3 text-[var(--text-secondary)] min-w-[16rem] align-top">
        <span className="block truncate" title={rule.section || ''}>
          {rule.section || '\u2014'}
        </span>
      </td>
      <td className="py-2.5 px-3 text-[var(--text-secondary)] text-xs leading-5 min-w-[22rem] break-words align-top">
        {rule.evidence || '\u2014'}
      </td>
    </tr>
  );
}

function EvalFailedBanner({ label, errorMsg }: { label: string; errorMsg: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md border text-sm bg-[var(--surface-error)] border-[var(--border-error)]">
      <AlertTriangle className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold text-[var(--text-primary)]">{label}:</span>{' '}
        <span className="text-[var(--text-secondary)]">{errorMsg}</span>
      </div>
    </div>
  );
}
