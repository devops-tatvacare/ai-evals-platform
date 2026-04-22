import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/utils';

interface PageSurfaceBack {
  to: string;
  label?: string;
}

interface PageSurfaceProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  /** When provided, renders an inline "← Back" button at the left of the header. */
  back?: PageSurfaceBack;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PageSurface({
  icon: Icon,
  title,
  subtitle,
  back,
  actions,
  filters,
  children,
  className,
}: PageSurfaceProps) {
  const navigate = useNavigate();
  const hasRightSlot = Boolean(filters || actions);

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]',
        className,
      )}
    >
      <div className="flex h-14 flex-shrink-0 items-center justify-between gap-4 border-b border-dashed border-[var(--border-subtle)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          {back && (
            <button
              type="button"
              onClick={() => navigate(back.to)}
              className="flex h-7 flex-shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label={back.label ? `Back to ${back.label}` : 'Back'}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {back.label && <span>{back.label}</span>}
            </button>
          )}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden />
              <h1 className="truncate text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
                {title}
              </h1>
            </div>
            {subtitle && (
              <div className="flex flex-shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="h-3 w-px bg-[var(--border-subtle)]" aria-hidden />
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {hasRightSlot && (
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
            {filters}
            {actions}
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
        {children}
      </div>
    </div>
  );
}
