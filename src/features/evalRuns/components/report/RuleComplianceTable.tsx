import type { RuleComplianceMatrix } from '@/types/reports';
import { cn } from '@/utils/cn';
import SectionHeader from './shared/SectionHeader';
import SegmentedBar from './shared/SegmentedBar';
import { SEVERITY_COLORS, METRIC_COLOR } from './shared/colors';
import { RULE_COMPLIANCE_INFO } from './sectionInfo';

interface Props {
  ruleCompliance: RuleComplianceMatrix;
}

export default function RuleComplianceTable({ ruleCompliance }: Props) {
  const { rules, coFailures } = ruleCompliance;

  if (rules.length === 0) {
    return (
        <section>
          <SectionHeader
            title="Rule Compliance Analysis"
            description="Pass, fail, and not-evaluated counts for each evaluation rule, sorted by compliance"
            infoTooltip={<RULE_COMPLIANCE_INFO />}
          />
        <p className="text-sm text-[var(--text-muted)] italic">No rule compliance data available.</p>
      </section>
    );
  }

  // Summary compliance bar segments
  const evaluatedRules = rules.filter((rule) => rule.passed + rule.failed > 0);
  const unevaluatedOnlyCount = rules.filter((rule) => rule.passed + rule.failed === 0 && rule.notEvaluated > 0).length;
  const goodCount = evaluatedRules.filter((r) => r.rate >= 0.8).length;
  const mediumCount = evaluatedRules.filter((r) => r.rate >= 0.5 && r.rate < 0.8).length;
  const badCount = evaluatedRules.filter((r) => r.rate < 0.5).length;

  const complianceSegments = [
    { label: `\u226580%: ${goodCount} rules`, value: goodCount, color: 'var(--color-success)' },
    { label: `50\u201379%: ${mediumCount} rules`, value: mediumCount, color: 'var(--color-warning)' },
    { label: `<50%: ${badCount} rules`, value: badCount, color: 'var(--color-error)' },
    { label: `Not evaluated: ${unevaluatedOnlyCount} rules`, value: unevaluatedOnlyCount, color: 'var(--color-verdict-na)' },
  ];

  return (
    <section>
          <SectionHeader
            title="Rule Compliance Analysis"
            description="Pass, fail, and not-evaluated counts for each evaluation rule, sorted by compliance"
            infoTooltip={<RULE_COMPLIANCE_INFO />}
          />

      {/* Summary compliance bar */}
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
          Overall Compliance: {rules.length} rules
        </p>
        <SegmentedBar
          segments={complianceSegments}
          barHeight="h-2"
          showValues={false}
          showLegendValues={false}
        />
      </div>

      {/* Rules table with severity dot + wider rate bars */}
      <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--border-subtle)]">
              <th style={{ width: 12 }} className="px-2 py-1.5" />
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Rule</th>
              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Section</th>
              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pass</th>
              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Fail</th>
              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Not Eval</th>
              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider" style={{ width: 180 }}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => {
              const hasEvaluatedData = rule.passed + rule.failed > 0;
              const ratePct = Math.round(rule.rate * 100);
              return (
                <tr
                  key={rule.ruleId}
                  className={cn(
                    i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]',
                    hasEvaluatedData && rule.rate < 0.5 && 'bg-[var(--surface-error)]',
                  )}
                >
                  <td className="px-2 py-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: SEVERITY_COLORS[rule.severity] ?? 'var(--color-verdict-na)' }}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono text-xs text-[var(--text-primary)]">
                    {rule.ruleId}
                  </td>
                  <td className="px-2 py-2 text-[var(--text-secondary)]">{rule.section}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-primary)]">{rule.passed}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-primary)]">{rule.failed}</td>
                  <td className="px-2 py-2 text-right text-[var(--text-primary)]">{rule.notEvaluated}</td>
                  <td className="px-2 py-2 text-right">
                    {hasEvaluatedData ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-24 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${ratePct}%`,
                              backgroundColor: METRIC_COLOR(ratePct),
                            }}
                          />
                        </div>
                        <span
                          className="text-xs font-semibold min-w-[32px] text-right"
                          style={{ color: METRIC_COLOR(ratePct) }}
                        >
                          {ratePct}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-[var(--text-muted)]">\u2014</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Co-failures as compact stripe rows */}
      {coFailures.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
            Co-Failure Patterns
          </h3>
          <div className="space-y-1.5">
            {coFailures.map((cf, i) => (
              <div
                key={i}
                className="flex items-center gap-1 flex-wrap px-3 py-2 bg-[var(--surface-warning)] rounded-md border-l-[3px] text-sm text-[var(--text-secondary)]"
                style={{ borderLeftColor: 'var(--color-warning)' }}
              >
                When <code className="font-mono font-semibold text-[var(--text-primary)]">{cf.ruleA}</code> fails,{' '}
                <code className="font-mono font-semibold text-[var(--text-primary)]">{cf.ruleB}</code> also fails in{' '}
                <span className="font-semibold">{Math.round(cf.coOccurrenceRate * 100)}%</span> of cases.
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
