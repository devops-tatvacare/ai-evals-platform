import type { ReactNode } from "react";
import VerdictBadge from "./VerdictBadge";
import type { LabelCategory } from "@/config/labelDefinitions";

interface Props {
  title: string;
  verdict?: string;
  verdictCategory?: LabelCategory;
  badge?: ReactNode;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export default function EvalSection({
  title,
  verdict,
  verdictCategory,
  badge,
  subtitle,
  children,
  defaultOpen = false,
}: Props) {
  return (
    <details open={defaultOpen || undefined} className="group">
      <summary className="flex items-center gap-2 text-[0.8rem] font-semibold text-slate-700 cursor-pointer hover:text-slate-900 py-1 select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="text-slate-400 text-[0.7rem] transition-transform group-open:rotate-90">
          {"\u25B6"}
        </span>
        <span>{title}</span>
        {verdict && <VerdictBadge verdict={verdict} category={verdictCategory} />}
        {badge}
        {subtitle && <span className="font-normal text-[0.72rem] text-slate-400">{subtitle}</span>}
      </summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

interface EvalCardProps {
  accentColor: string;
  children: ReactNode;
}

export function EvalCard({ accentColor, children }: EvalCardProps) {
  return (
    <div
      className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5"
      style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}
    >
      {children}
    </div>
  );
}

export function EvalCardHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">{children}</div>
  );
}

export function EvalCardBody({ children }: { children: ReactNode }) {
  return (
    <div className="text-[0.78rem] text-slate-600 leading-relaxed">{children}</div>
  );
}
