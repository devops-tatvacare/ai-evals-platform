import type { CustomEvalNarrative as CustomEvalNarrativeType } from '@/types/reports';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--color-error)',
  high: 'var(--color-warning)',
  medium: 'var(--color-info)',
  low: 'var(--color-verdict-na)',
};

interface Props {
  narrative: CustomEvalNarrativeType;
}

export default function CustomNarrative({ narrative }: Props) {
  return (
    <div className="space-y-5">
      {/* Overall Assessment */}
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-3">
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          {narrative.overallAssessment}
        </p>
      </div>

      {/* Key Findings */}
      {narrative.keyFindings.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Key Findings
          </h4>
          <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[var(--border-subtle)]">
                  <th style={{ width: 12 }} className="px-2 py-1.5" />
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Finding</th>
                  <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Severity</th>
                  <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Affected</th>
                </tr>
              </thead>
              <tbody>
                {narrative.keyFindings.map((f, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}>
                    <td className="px-2 py-2 align-top">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: SEVERITY_COLORS[f.severity] ?? 'var(--color-verdict-na)' }}
                      />
                    </td>
                    <td className="px-2 py-2 align-top text-[var(--text-primary)]">{f.finding}</td>
                    <td className="px-2 py-2 align-top capitalize text-[var(--text-muted)]">{f.severity}</td>
                    <td className="px-2 py-2 align-top text-right text-[var(--text-muted)]">{f.affectedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notable Patterns */}
      {narrative.notablePatterns.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Notable Patterns
          </h4>
          <ul className="space-y-1.5">
            {narrative.notablePatterns.map((pattern, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0" />
                {pattern}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
