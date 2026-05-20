import type { ReactNode, Ref } from 'react';
import { BarChart3, Hash, Inbox, ListChecks, Table2 } from 'lucide-react';

import { cn } from '@/utils/cn';
import type { ChartPayload } from '../types';

type ArtifactKind = ChartPayload['kind'];

const KIND_ICON: Record<ArtifactKind, typeof BarChart3> = {
  chart: BarChart3,
  kpi: Hash,
  summary: ListChecks,
  table: Table2,
  empty: Inbox,
};

interface ChatArtifactCardProps {
  kind: ArtifactKind;
  title?: string;
  subtitle?: string;
  warning?: string | null;
  actions?: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  bodyClassName?: string;
  children: ReactNode;
}

// One frame for every chat artifact (chart / kpi / summary / table / empty):
// brand hairline, tinted kind glyph, header + actions, warning strip, body.
// Card chrome lives here only — bodies are pure content.
export function ChatArtifactCard({
  kind, title, subtitle, warning, actions, bodyRef, bodyClassName, children,
}: ChatArtifactCardProps) {
  const Icon = KIND_ICON[kind] ?? BarChart3;
  const hasHeader = Boolean(title || actions);

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow-md)]"
      data-artifact-kind={kind}
    >
      <div className="h-0.5 w-full [background-image:var(--gradient-brand-mark)]" />
      {hasHeader ? (
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              {title ? (
                <div className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">
                  {title}
                </div>
              ) : null}
              {subtitle && subtitle !== title ? (
                <div className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{subtitle}</div>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {warning ? (
        <div className="border-b border-[var(--border-warning)] bg-[var(--surface-warning)] px-4 py-2 text-[11px] text-[var(--color-warning-dark)]">
          {warning}
        </div>
      ) : null}
      <div ref={bodyRef} className={cn('px-4 py-3.5', bodyClassName)}>
        {children}
      </div>
    </div>
  );
}
