import { Sparkles, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export type ReportTone = 'positive' | 'success' | 'warning' | 'negative' | 'danger' | 'error' | 'info' | 'neutral' | string;

export type CalloutVariant = 'info' | 'success' | 'warning' | 'danger' | 'insight';

const TONE_BG: Record<string, string> = {
  positive: 'var(--surface-success)',
  success: 'var(--surface-success)',
  warning: 'var(--surface-warning)',
  negative: 'var(--surface-error)',
  danger: 'var(--surface-error)',
  error: 'var(--surface-error)',
  info: 'var(--surface-info)',
};

const TONE_TEXT: Record<string, string> = {
  positive: 'var(--color-success)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  negative: 'var(--color-error)',
  danger: 'var(--color-error)',
  error: 'var(--color-error)',
  info: 'var(--color-info)',
};

const TONE_RULE: Record<string, string> = {
  positive: 'var(--color-success)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  negative: 'var(--color-error)',
  danger: 'var(--color-error)',
  error: 'var(--color-error)',
  info: 'var(--color-info)',
};

export function toneText(tone: ReportTone | null | undefined): string {
  if (!tone) return 'var(--text-primary)';
  return TONE_TEXT[tone] ?? 'var(--text-primary)';
}

export function toneSurface(tone: ReportTone | null | undefined): string {
  if (!tone) return 'var(--bg-tertiary)';
  return TONE_BG[tone] ?? 'var(--bg-tertiary)';
}

export function toneRule(tone: ReportTone | null | undefined): string | null {
  if (!tone) return null;
  return TONE_RULE[tone] ?? null;
}

export function toneToCalloutVariant(tone: ReportTone | null | undefined): CalloutVariant {
  if (tone === 'positive' || tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'danger';
  return 'info';
}

export interface SectionShellProps {
  tone?: ReportTone | null;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  /** When true, render without the bordered panel (used by branches that bring their own composite layout). */
  bare?: boolean;
}

export function SectionShell({ tone, className, bodyClassName, children, bare }: SectionShellProps) {
  if (bare) {
    return <div className={cn('relative', className)}>{children}</div>;
  }

  const rule = toneRule(tone);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
        className,
      )}
    >
      {rule ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: rule }}
        />
      ) : null}
      <div className={cn('px-4 py-3', bodyClassName)}>{children}</div>
    </div>
  );
}

export interface SectionHeaderProps {
  kicker?: string | null;
  title: string;
  description?: string | null;
  actions?: ReactNode;
  className?: string;
}

export function SectionHeader({ kicker, title, description, actions, className }: SectionHeaderProps) {
  return (
    <header className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {kicker ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{kicker}</div>
        ) : null}
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

export interface KpiTileProps {
  label: string;
  value: string | number;
  subtitle?: string | null;
  tone?: ReportTone | null;
  icon?: LucideIcon;
  className?: string;
}

export function KpiTile({ label, value, subtitle, tone, icon: Icon, className }: KpiTileProps) {
  const valueColor = toneText(tone);
  const rule = toneRule(tone);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-3',
        className,
      )}
    >
      {rule ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[2px]" style={{ backgroundColor: rule }} />
      ) : null}
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div
        className="mt-1.5 text-[22px] font-semibold leading-tight tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      {subtitle ? (
        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{subtitle}</div>
      ) : null}
    </div>
  );
}

export interface SectionEmptyProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  className?: string;
}

export function SectionEmpty({
  title = 'Nothing to show yet',
  description = 'This section has no data for this run.',
  icon: Icon = Sparkles,
  className,
}: SectionEmptyProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 text-sm',
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium text-[var(--text-primary)]">{title}</div>
        <div className="text-xs text-[var(--text-muted)]">{description}</div>
      </div>
    </div>
  );
}
