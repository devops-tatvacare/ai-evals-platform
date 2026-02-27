import { useState } from 'react';
import type { RuleCompliance, CorrectnessEvaluation, EfficiencyEvaluation } from '@/types/evalRuns';
import { cn } from '@/utils';

type Filter = 'ALL' | 'VIOLATIONS' | 'PASSED';

interface AggregatedRule extends RuleCompliance {
  source: string;
}

interface Props {
  efficiencyEvaluation?: EfficiencyEvaluation | null;
  correctnessEvaluations?: CorrectnessEvaluation[];
  /** Pass rules directly (e.g. from adversarial results) — skips aggregation */
  rules?: RuleCompliance[];
  /** Label for the source column when using direct rules */
  sourceLabel?: string;
}

function aggregateRules(
  efficiencyEvaluation?: EfficiencyEvaluation | null,
  correctnessEvaluations?: CorrectnessEvaluation[],
): AggregatedRule[] {
  const ruleMap = new Map<string, AggregatedRule>();

  // Efficiency rules
  if (efficiencyEvaluation?.rule_compliance) {
    for (const rule of efficiencyEvaluation.rule_compliance) {
      const existing = ruleMap.get(rule.rule_id);
      // Keep violations over passes
      if (!existing || !rule.followed) {
        ruleMap.set(rule.rule_id, { ...rule, source: 'Efficiency' });
      }
    }
  }

  // Correctness rules (per-message)
  if (correctnessEvaluations) {
    for (let i = 0; i < correctnessEvaluations.length; i++) {
      const ce = correctnessEvaluations[i];
      if (!ce.rule_compliance) continue;
      for (const rule of ce.rule_compliance) {
        const existing = ruleMap.get(rule.rule_id);
        if (!existing || !rule.followed) {
          ruleMap.set(rule.rule_id, {
            ...rule,
            source: `Correctness #${i + 1}`,
          });
        }
      }
    }
  }

  return Array.from(ruleMap.values());
}

export default function RuleComplianceTab({ efficiencyEvaluation, correctnessEvaluations, rules, sourceLabel = 'Overall' }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');

  // Use direct rules if provided, otherwise aggregate from evaluations
  const allRules: AggregatedRule[] = rules
    ? rules.map(r => ({ ...r, source: sourceLabel }))
    : aggregateRules(efficiencyEvaluation, correctnessEvaluations);

  if (allRules.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-4 text-center">
        No rule compliance data available.
      </p>
    );
  }

  const violations = allRules.filter(r => !r.followed);
  const passed = allRules.filter(r => r.followed);

  const filtered = filter === 'ALL'
    ? [...violations, ...passed]
    : filter === 'VIOLATIONS'
      ? violations
      : passed;

  return (
    <div className="flex flex-col h-full min-h-0 px-4">
      {/* Filter pills */}
      <div className="flex flex-wrap gap-1 pb-3 shrink-0">
        {([
          { key: 'ALL' as Filter, label: 'All', count: allRules.length },
          { key: 'VIOLATIONS' as Filter, label: 'Violations', count: violations.length },
          { key: 'PASSED' as Filter, label: 'Passed', count: passed.length },
        ]).map(f => (
          f.count === 0 && f.key !== 'ALL' ? null : (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-2 py-0.5 text-xs rounded-full border transition-colors',
                filter === f.key
                  ? 'border-[var(--border-brand)] bg-[var(--surface-info)] text-[var(--text-brand)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              )}
            >
              {f.label} ({f.count})
            </button>
          )
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 650 }}>
          <thead className="sticky top-0 bg-[var(--bg-primary)] z-10">
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-center text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-12">Status</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 whitespace-nowrap">Rule ID</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 whitespace-nowrap">Section in Kaira Prompt</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2 w-28">Source</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1.5 px-2">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((rule, i) => (
              <tr key={`${rule.rule_id}-${i}`} className="border-b border-[var(--border-subtle)]">
                <td className="py-1.5 px-2 text-center">
                  <span
                    className={`inline-block w-4 h-4 rounded-full text-[0.6rem] font-bold text-white leading-none ${
                      rule.followed ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
                    }`}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {rule.followed ? '\u2713' : '\u2717'}
                  </span>
                </td>
                <td className={`py-1.5 px-2 font-semibold ${rule.followed ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                  {rule.rule_id}
                </td>
                <td className="py-1.5 px-2 text-[var(--text-secondary)] max-w-[160px]">
                  {rule.section && (
                    <span className="block text-xs bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-1.5 py-px rounded-full truncate" title={rule.section}>
                      {rule.section}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-2 text-[var(--text-muted)] text-xs">
                  {rule.source}
                </td>
                <td className="py-1.5 px-2 text-[var(--text-secondary)] text-xs">
                  {rule.evidence || '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
