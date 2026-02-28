import type { HealthScore, NarrativeOutput } from '@/types/reports';
import SectionHeader from './shared/SectionHeader';
import { METRIC_COLOR, PRIORITY_DOT_COLORS, rankToPriority } from './shared/colors';

interface Props {
  healthScore: HealthScore;
  narrative: NarrativeOutput | null;
  isAdversarial?: boolean;
}

export default function ExecutiveSummary({ healthScore, narrative, isAdversarial }: Props) {
  const { breakdown } = healthScore;

  const metrics = isAdversarial
    ? [
        { label: 'Pass Rate', item: breakdown.intentAccuracy },
        { label: 'Goal Achievement', item: breakdown.correctnessRate },
        { label: 'Rule Compliance', item: breakdown.efficiencyRate },
        { label: 'Difficulty Score', item: breakdown.taskCompletion },
      ]
    : [
        { label: 'Intent Accuracy', item: breakdown.intentAccuracy },
        { label: 'Correctness', item: breakdown.correctnessRate },
        { label: 'Efficiency', item: breakdown.efficiencyRate },
        { label: 'Task Completion', item: breakdown.taskCompletion },
      ];

  return (
    <section>
      <SectionHeader
        title="Executive Summary"
        description="Health metrics and AI-generated assessment of this evaluation run"
      />

      {/* Compact stat row */}
      <div className="flex flex-wrap items-center gap-6 py-3 mb-4">
        {metrics.map(({ label, item }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">{label}</span>
            <span
              className="text-sm font-bold"
              style={{ color: METRIC_COLOR(item.value) }}
            >
              {Math.round(item.value)}%
            </span>
            <div className="w-12 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${item.value}%`,
                  backgroundColor: METRIC_COLOR(item.value),
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* AI Assessment prose */}
      {narrative?.executiveSummary ? (
        <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-3 mb-4">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            {narrative.executiveSummary}
          </p>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic mb-4">
          AI narrative was not generated for this report.
        </p>
      )}

      {/* Top Issues — dot table */}
      {narrative?.topIssues && narrative.topIssues.length > 0 && (
        <div className="mt-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Top Issues</h3>
          <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--border-subtle)]">
                  <th style={{ width: 12 }} className="px-2 py-1.5" />
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Issue</th>
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Focus Area</th>
                  <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{isAdversarial ? 'Tests Affected' : 'Threads Affected'}</th>
                </tr>
              </thead>
              <tbody>
                {narrative.topIssues.map((issue, i) => {
                  const priority = rankToPriority(issue.rank);
                  return (
                    <tr key={issue.rank} className={i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}>
                      <td className="px-2 py-2 align-top">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: PRIORITY_DOT_COLORS[priority] }}
                        />
                      </td>
                      <td className="px-2 py-2 align-top font-semibold text-[var(--text-primary)]">{issue.description}</td>
                      <td className="px-2 py-2 align-top whitespace-nowrap text-[var(--text-muted)]">{issue.area}</td>
                      <td className="px-2 py-2 align-top text-right text-[var(--text-muted)] whitespace-nowrap">{issue.affectedCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
