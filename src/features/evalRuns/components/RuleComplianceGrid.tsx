import type { RuleCompliance } from "@/types";

interface Props {
  rules: RuleCompliance[];
}

export default function RuleComplianceGrid({ rules }: Props) {
  if (rules.length === 0) return null;

  const violations = rules.filter((r) => !r.followed);
  const passes = rules.filter((r) => r.followed);

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        Rule Compliance
        <span className="ml-1.5 normal-case tracking-normal font-normal">
          {violations.length === 0
            ? `\u2014 All ${rules.length} rules followed`
            : `\u2014 ${violations.length} of ${rules.length} violated`}
        </span>
      </p>
      <div className="grid gap-1">
        {violations.map((r) => (
          <RuleRow key={r.rule_id} rule={r} />
        ))}
        {passes.map((r) => (
          <RuleRow key={r.rule_id} rule={r} />
        ))}
      </div>
    </div>
  );
}

function RuleRow({ rule }: { rule: RuleCompliance }) {
  const passed = rule.followed;

  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-sm ${
        passed
          ? "bg-[var(--surface-success)] border border-[var(--border-success)]"
          : "bg-[var(--surface-error)] border border-[var(--border-error)]"
      }`}
    >
      <span
        className={`shrink-0 w-4 h-4 mt-px rounded-full flex items-center justify-center text-[0.6rem] font-bold text-white ${
          passed ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"
        }`}
      >
        {passed ? "\u2713" : "\u2717"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-semibold ${passed ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`}>
            {rule.rule_id}
          </span>
          {rule.section && (
            <span className="text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-1.5 py-px rounded-full whitespace-nowrap">
              {rule.section}
            </span>
          )}
        </div>
        {rule.evidence && (
          <p className={`mt-0.5 break-words ${passed ? "text-[var(--color-success)]" : "text-[var(--color-error)]"}`} style={{ opacity: 0.8 }}>
            {rule.evidence}
          </p>
        )}
      </div>
    </div>
  );
}
