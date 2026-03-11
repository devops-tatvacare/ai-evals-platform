import type { AdversarialBreakdown as AdversarialBreakdownType } from '@/types/reports';
import SectionHeader from './shared/SectionHeader';
import { DIFFICULTY_COLORS, METRIC_HEX } from './shared/colors';
import { ADVERSARIAL_INFO } from './sectionInfo';

interface Props {
  adversarial: AdversarialBreakdownType;
}

export default function AdversarialBreakdown({ adversarial }: Props) {
  const sortedGoals = [...adversarial.byGoal].sort((a, b) => a.passRate - b.passRate);

  const difficultyOrder = ['EASY', 'MEDIUM', 'HARD'];
  const sortedDifficulty = [...adversarial.byDifficulty].sort(
    (a, b) => difficultyOrder.indexOf(a.difficulty) - difficultyOrder.indexOf(b.difficulty),
  );

  return (
    <section>
      <SectionHeader
        title="Adversarial Testing Results"
        description="How the bot handled adversarial test scenarios by goal and difficulty"
        infoTooltip={<ADVERSARIAL_INFO />}
      />

      {sortedGoals.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
            Pass Rate by Goal
          </h4>
          <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--border-subtle)]">
                  <th className="text-left px-3 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Goal</th>
                  <th className="text-center px-3 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider" style={{ width: 70 }}>Passed</th>
                  <th className="text-center px-3 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider" style={{ width: 70 }}>Failed</th>
                  <th className="text-right px-3 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider" style={{ width: 180 }}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {sortedGoals.map((g, i) => {
                  const rate = Math.round(g.passRate * 100);
                  const barColor = METRIC_HEX(rate);
                  const failed = g.total - g.passed;
                  return (
                    <tr
                      key={g.goal}
                      className={
                        g.passRate < 0.5
                          ? 'bg-red-50 dark:bg-red-950/20'
                          : i % 2 === 0
                            ? 'bg-[var(--bg-primary)]'
                            : 'bg-[var(--bg-secondary)]'
                      }
                    >
                      <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{g.goal}</td>
                      <td className="px-3 py-2 text-center text-[var(--color-success)]">{g.passed}</td>
                      <td className="px-3 py-2 text-center text-[var(--color-error)]">{failed}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-24 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${rate}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <span
                            className="text-xs font-semibold min-w-[32px] text-right"
                            style={{ color: barColor }}
                          >
                            {rate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
            {sortedGoals.map((g) => (
              <span key={g.goal} className="text-xs text-[var(--text-secondary)]">
                {g.goal}: <span className="font-semibold">{g.passed}/{g.total}</span>{' '}
                <span className="text-[var(--text-muted)]">({Math.round(g.passRate * 100)}%)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Compact inline stat row for difficulty */}
      {sortedDifficulty.length > 0 && (
        <div className="flex items-center gap-6 py-2 mt-4 text-sm">
          {sortedDifficulty.map((d) => {
            const rate = d.total > 0 ? Math.round((d.passed / d.total) * 100) : 0;
            return (
              <div key={d.difficulty}>
                <span className="text-[var(--text-muted)] text-xs">{d.difficulty}</span>
                <span
                  className="font-bold ml-1"
                  style={{ color: DIFFICULTY_COLORS[d.difficulty] ?? METRIC_HEX(rate) }}
                >
                  {rate}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
