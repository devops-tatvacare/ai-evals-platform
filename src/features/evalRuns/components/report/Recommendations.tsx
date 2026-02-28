import type { NarrativeOutput, Recommendation } from '@/types/reports';
import SectionHeader from './shared/SectionHeader';
import CalloutBox from './shared/CalloutBox';
import {
  PRIORITY_STYLES,
  PRIORITY_DOT_COLORS,
  parseImpactSegments,
} from './shared/colors';

interface Props {
  narrative: NarrativeOutput | null;
}

export default function Recommendations({ narrative }: Props) {
  const recommendations = narrative?.recommendations ?? [];

  return (
    <section>
      <SectionHeader
        title="Recommendations"
        description="AI-generated improvement actions prioritized by impact"
      />

      {recommendations.length > 0 ? (
        <div className="space-y-6">
          {(['P0', 'P1', 'P2'] as const).map((priority) => {
            const group = recommendations.filter((r) => r.priority === priority);
            if (group.length === 0) return null;
            return (
              <div key={priority}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  {PRIORITY_STYLES[priority].label}
                </h4>
                <RecommendationsTable items={group} />
              </div>
            );
          })}
        </div>
      ) : (
        <CalloutBox variant="info">
          <span className="italic">AI-generated recommendations are not available for this report.</span>
        </CalloutBox>
      )}
    </section>
  );
}

/** Shared table used by both Recommendations (detailed) and Summary tab (top 3). */
export function RecommendationsTable({ items }: { items: Recommendation[] }) {
  return (
    <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[var(--border-subtle)]">
            <th style={{ width: 12 }} className="px-2 py-1.5" />
            <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Action</th>
            <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider" style={{ width: 100 }}>Focus Area</th>
            <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap" style={{ width: 160 }}>Projected Reduction</th>
          </tr>
        </thead>
        <tbody>
          {items.map((rec, i) => {
            const segments = rec.estimatedImpact ? parseImpactSegments(rec.estimatedImpact) : [];
            return (
              <tr key={i} className={i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}>
                <td className="px-2 py-2.5 align-top">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: PRIORITY_DOT_COLORS[rec.priority] ?? '#6b7280' }}
                  />
                </td>
                <td className="px-2 py-2.5 align-top font-medium text-[var(--text-primary)]">{rec.action}</td>
                <td className="px-2 py-2.5 align-top text-[var(--text-muted)]">{rec.area}</td>
                <td className="px-2 py-2.5 align-top text-right whitespace-nowrap text-xs">
                  {segments.length > 0 ? (
                    <div className="space-y-1">
                      {segments.map((seg, j) => (
                        <div key={j} className="text-[var(--color-success)]">
                          {seg.arrow && <span>{seg.arrow}{seg.count} </span>}
                          <code className="text-[11px] bg-[var(--surface-success)] px-1 py-px rounded text-[var(--color-success)]">
                            {seg.label}
                          </code>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[var(--text-muted)]">&mdash;</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
