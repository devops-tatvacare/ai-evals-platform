import type { ReactNode } from 'react';
import { cn } from '@/utils';

interface PageShellProps {
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  filterSlot?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PageShell({
  title,
  subtitle,
  headerActions,
  filterSlot,
  children,
  className,
}: PageShellProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div
        className="sticky top-0 border-b border-[var(--border-default)] bg-[var(--bg-primary)] pb-4"
        style={{ zIndex: 'var(--z-sticky)' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                {subtitle}
              </p>
            )}
          </div>
          {headerActions && (
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              {headerActions}
            </div>
          )}
        </div>
        {filterSlot && <div className="mt-3">{filterSlot}</div>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-4">{children}</div>
    </div>
  );
}
