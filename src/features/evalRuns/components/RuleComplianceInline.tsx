import type { RuleCompliance } from '@/types';

interface Props {
  rules: RuleCompliance[];
}

export default function RuleComplianceInline({ rules }: Props) {
  if (rules.length === 0) return null;

  const violations = rules.filter((r) => r.followed === false);
  const passes = rules.filter((r) => r.followed === true);
  const notEvaluated = rules.filter((r) => r.followed === null);
  const sorted = [...violations, ...passes, ...notEvaluated];
  const evaluatedCount = violations.length + passes.length;

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        Rule Compliance
        <span className="ml-1.5 normal-case tracking-normal font-normal">
          {violations.length === 0
            ? `\u2014 All ${evaluatedCount} followed`
            : `\u2014 ${violations.length} of ${evaluatedCount} violated`}
          {notEvaluated.length > 0 && ` (${notEvaluated.length} not evaluated)`}
        </span>
      </p>
      <div className="overflow-x-auto" style={{ minWidth: 500 }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1 px-2 w-10">Status</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1 px-2 w-24">Rule ID</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1 px-2 w-28">Section</th>
              <th className="text-left text-xs text-[var(--text-muted)] font-semibold py-1 px-2">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.rule_id}
                className="border-b border-[var(--border-subtle)] last:border-b-0"
              >
                <td className="py-1 px-2">
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[0.6rem] font-bold text-white ${
                      r.followed === null ? 'bg-[var(--text-muted)]' : r.followed ? 'bg-[var(--color-success)]' : 'bg-[var(--color-error)]'
                    }`}
                  >
                    {r.followed === null ? '?' : r.followed ? '\u2713' : '\u2717'}
                  </span>
                </td>
                <td className={`py-1 px-2 font-semibold ${r.followed === null ? 'text-[var(--text-muted)]' : r.followed ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                  {r.rule_id}
                </td>
                <td className="py-1 px-2 text-[var(--text-secondary)]">{r.section}</td>
                <td className="py-1 px-2 text-[var(--text-secondary)] break-words">{r.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
