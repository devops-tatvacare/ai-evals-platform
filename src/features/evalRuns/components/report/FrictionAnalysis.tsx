import { ExternalLink } from 'lucide-react';
import type { FrictionAnalysis as FrictionAnalysisType } from '@/types/reports';
import { routes } from '@/config/routes';
import SectionHeader from './shared/SectionHeader';
import SegmentedBar from './shared/SegmentedBar';
import type { BarSegment } from './shared/SegmentedBar';
import { VERDICT_COLORS, RECOVERY_COLORS, verdictLabel } from './shared/colors';
import { FRICTION_INFO } from './sectionInfo';
import { KpiTile, SectionEmpty } from '@/features/analytics/components/reportPrimitives';

interface Props {
  friction: FrictionAnalysisType;
  runId?: string;
}

const CAUSE_COLORS: Record<string, string> = {
  bot: 'var(--color-error)',
  user: 'var(--color-info)',
};

const VERDICT_TURNS_ORDER = ['EFFICIENT', 'ACCEPTABLE', 'FRICTION', 'BROKEN'];

export default function FrictionAnalysis({ friction, runId }: Props) {
  const botCaused = friction.byCause['bot'] ?? 0;
  const userCaused = friction.byCause['user'] ?? 0;
  const notNeededCount = friction.recoveryQuality['NOT NEEDED'] ?? friction.recoveryQuality['NOT_NEEDED'] ?? 0;

  const causeSegments: BarSegment[] = Object.entries(friction.byCause)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      label: verdictLabel(name),
      value,
      color: CAUSE_COLORS[name] ?? 'var(--color-verdict-na)',
    }));

  const recoverySegments: BarSegment[] = Object.entries(friction.recoveryQuality)
    .filter(([key, v]) => v > 0 && key !== 'NOT_NEEDED' && key !== 'NOT NEEDED')
    .map(([name, value]) => ({
      label: verdictLabel(name),
      value,
      color: RECOVERY_COLORS[name] ?? RECOVERY_COLORS[name.replace(' ', '_')] ?? 'var(--color-verdict-na)',
    }));

  const avgTurnsSegments: BarSegment[] = VERDICT_TURNS_ORDER
    .filter((v) => friction.avgTurnsByVerdict[v] != null && friction.avgTurnsByVerdict[v] > 0)
    .map((name) => ({
      label: verdictLabel(name),
      value: Number(friction.avgTurnsByVerdict[name].toFixed(1)),
      color: VERDICT_COLORS[name] ?? 'var(--color-verdict-na)',
    }));

  // Hide the whole section content when no friction was observed — three KPI
  // tiles all zero + three empty bar groups + no patterns is noise. Empty-state
  // primitive instead — same shape as every other refreshed section.
  const hasAnyData =
    friction.totalFrictionTurns > 0 ||
    botCaused > 0 ||
    userCaused > 0 ||
    causeSegments.length > 0 ||
    recoverySegments.length > 0 ||
    avgTurnsSegments.length > 0 ||
    friction.topPatterns.length > 0;

  if (!hasAnyData) {
    return (
      <section>
        <SectionHeader
          title="Friction & Efficiency Analysis"
          description="Conversation friction points, causes, and recovery quality"
          infoTooltip={<FRICTION_INFO />}
        />
        <SectionEmpty
          title="No friction observed"
          description="No friction turns were detected for this run."
        />
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        title="Friction & Efficiency Analysis"
        description="Conversation friction points, causes, and recovery quality"
        infoTooltip={<FRICTION_INFO />}
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-5">
        <KpiTile label="Total Friction" value={friction.totalFrictionTurns} />
        <KpiTile label="Bot-Caused" value={botCaused} tone={botCaused > 0 ? 'error' : 'neutral'} />
        <KpiTile label="User-Caused" value={userCaused} tone={userCaused > 0 ? 'info' : 'neutral'} />
      </div>

      {(causeSegments.length > 0 || recoverySegments.length > 0 || avgTurnsSegments.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {causeSegments.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
                Friction by Cause
              </h4>
              <SegmentedBar segments={causeSegments} barHeight="h-6" />
            </div>
          )}

          {recoverySegments.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
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
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
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

      {friction.topPatterns.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-3">
            Top Friction Patterns
          </h4>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-secondary)]">
                <tr>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-[0.14em]" style={{ width: 28 }}>#</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-[0.14em]">Pattern</th>
                  <th className="text-right px-2 py-2 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-[0.14em]">Count</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-[0.14em]">Example Threads</th>
                </tr>
              </thead>
              <tbody>
                {friction.topPatterns.map((pattern, i) => (
                  <tr key={i} className={i === 0 ? '' : 'border-t border-[var(--border-subtle)]'}>
                    <td className="px-2 py-2 tabular-nums text-[var(--text-muted)]">{i + 1}</td>
                    <td className="px-2 py-2 font-medium text-[var(--text-primary)]">{pattern.description}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-[var(--text-primary)]">{pattern.count}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {pattern.exampleThreadIds.slice(0, 3).map((tid, j) => (
                          <span key={tid} className="inline-flex items-center gap-1">
                            <span className="font-mono text-xs text-[var(--text-muted)]">
                              {tid.slice(0, 12)}
                            </span>
                            {runId && (
                              <a
                                href={routes.kaira.threadDetail(tid, runId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--text-muted)] hover:text-[var(--text-brand)] transition-colors print:hidden"
                                title="Open thread in new tab"
                              >
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                            {j < Math.min(pattern.exampleThreadIds.length, 3) - 1 && (
                              <span className="text-[var(--text-muted)]">,</span>
                            )}
                          </span>
                        ))}
                      </div>
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
