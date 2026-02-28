import type { FrictionAnalysis as FrictionAnalysisType } from '@/types/reports';
import SectionHeader from './shared/SectionHeader';
import SegmentedBar from './shared/SegmentedBar';
import type { BarSegment } from './shared/SegmentedBar';
import { VERDICT_COLORS, RECOVERY_COLORS, verdictLabel } from './shared/colors';

interface Props {
  friction: FrictionAnalysisType;
}

const CAUSE_COLORS: Record<string, string> = {
  bot: '#EF4444',
  user: '#3b82f6',
};

const VERDICT_TURNS_ORDER = ['EFFICIENT', 'ACCEPTABLE', 'FRICTION', 'BROKEN'];

export default function FrictionAnalysis({ friction }: Props) {
  const botCaused = friction.byCause['bot'] ?? 0;
  const userCaused = friction.byCause['user'] ?? 0;
  const notNeededCount = friction.recoveryQuality['NOT NEEDED'] ?? friction.recoveryQuality['NOT_NEEDED'] ?? 0;

  const causeSegments: BarSegment[] = Object.entries(friction.byCause)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      label: verdictLabel(name),
      value,
      color: CAUSE_COLORS[name] ?? '#6b7280',
    }));

  const recoverySegments: BarSegment[] = Object.entries(friction.recoveryQuality)
    .filter(([key, v]) => v > 0 && key !== 'NOT_NEEDED' && key !== 'NOT NEEDED')
    .map(([name, value]) => ({
      label: verdictLabel(name),
      value,
      color: RECOVERY_COLORS[name] ?? RECOVERY_COLORS[name.replace(' ', '_')] ?? '#6b7280',
    }));

  const avgTurnsSegments: BarSegment[] = VERDICT_TURNS_ORDER
    .filter((v) => friction.avgTurnsByVerdict[v] != null && friction.avgTurnsByVerdict[v] > 0)
    .map((name) => ({
      label: verdictLabel(name),
      value: Number(friction.avgTurnsByVerdict[name].toFixed(1)),
      color: VERDICT_COLORS[name] ?? '#6b7280',
    }));

  return (
    <section>
      <SectionHeader
        title="Friction & Efficiency Analysis"
        description="Conversation friction points, causes, and recovery quality"
      />

      {/* Centered highlight stat box */}
      <div className="flex items-center justify-center gap-8 py-2.5 px-6 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg mb-5">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Total Friction
          </span>
          <span className="text-lg font-extrabold text-[var(--text-primary)]">
            {friction.totalFrictionTurns}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Bot-Caused
          </span>
          <span className="text-lg font-extrabold text-red-500">
            {botCaused}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            User-Caused
          </span>
          <span className="text-lg font-extrabold text-blue-500">
            {userCaused}
          </span>
        </div>
      </div>

      {/* Three segmented bars in one row */}
      {(causeSegments.length > 0 || recoverySegments.length > 0 || avgTurnsSegments.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {causeSegments.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Friction by Cause
              </h4>
              <SegmentedBar segments={causeSegments} barHeight="h-6" />
            </div>
          )}

          {recoverySegments.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Recovery Quality
              </h4>
              <SegmentedBar segments={recoverySegments} barHeight="h-6" />
              {notNeededCount > 0 && (
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  {notNeededCount} turn{notNeededCount !== 1 ? 's' : ''} required no recovery.
                </p>
              )}
            </div>
          )}

          {avgTurnsSegments.length > 0 && (
            <div>
              <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                Avg Turns by Verdict
              </h4>
              <SegmentedBar
                segments={avgTurnsSegments}
                barHeight="h-6"
                formatValue={(v) => v.toFixed(1)}
              />
            </div>
          )}
        </div>
      )}

      {/* Friction patterns table */}
      {friction.topPatterns.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
            Top Friction Patterns
          </h4>
          <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--border-subtle)]">
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider" style={{ width: 28 }}>#</th>
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pattern</th>
                  <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Count</th>
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Example Threads</th>
                </tr>
              </thead>
              <tbody>
                {friction.topPatterns.map((pattern, i) => (
                  <tr
                    key={i}
                    className={i === 0 ? 'bg-[var(--surface-warning)]' : i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}
                  >
                    <td className="px-2 py-2 text-[var(--text-muted)]">{i + 1}</td>
                    <td className="px-2 py-2 font-medium text-[var(--text-primary)]">{pattern.description}</td>
                    <td className="px-2 py-2 text-right font-semibold text-[var(--text-primary)]">{pattern.count}</td>
                    <td className="px-2 py-2">
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {pattern.exampleThreadIds.slice(0, 3).join(', ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
