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
      <summary className="flex items-center gap-2 text-[0.8rem] font-semibold text-[var(--text-primary)] cursor-pointer hover:text-[var(--text-primary)] py-1 select-none list-none [&::-webkit-details-marker]:hidden">
        <span className="text-[var(--text-muted)] text-[var(--text-xs)] transition-transform group-open:rotate-90">
          {"\u25B6"}
        </span>
        <span>{title}</span>
        {verdict && <VerdictBadge verdict={verdict} category={verdictCategory} />}
        {badge}
        {subtitle && <span className="font-normal text-[var(--text-xs)] text-[var(--text-muted)]">{subtitle}</span>}
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
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 space-y-1.5"
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
    <div className="text-[var(--text-sm)] text-[var(--text-secondary)] leading-relaxed">{children}</div>
  );
}
