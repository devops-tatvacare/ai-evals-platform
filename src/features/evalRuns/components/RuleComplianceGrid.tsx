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
      <p className="text-[0.68rem] uppercase tracking-wider text-slate-400 font-semibold">
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
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-[0.74rem] ${
        passed
          ? "bg-emerald-50 border border-emerald-200/80"
          : "bg-red-50 border border-red-200/80"
      }`}
    >
      <span
        className={`shrink-0 w-4 h-4 mt-px rounded-full flex items-center justify-center text-[0.6rem] font-bold text-white ${
          passed ? "bg-emerald-500" : "bg-red-500"
        }`}
      >
        {passed ? "\u2713" : "\u2717"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-semibold ${passed ? "text-emerald-800" : "text-red-800"}`}>
            {rule.rule_id}
          </span>
          {rule.section && (
            <span className="text-[0.62rem] text-slate-500 bg-white/70 border border-slate-200 px-1.5 py-px rounded-full whitespace-nowrap">
              {rule.section}
            </span>
          )}
        </div>
        {rule.evidence && (
          <p className={`mt-0.5 break-words ${passed ? "text-emerald-700/80" : "text-red-700/80"}`}>
            {rule.evidence}
          </p>
        )}
      </div>
    </div>
  );
}
