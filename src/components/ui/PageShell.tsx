import type { ReactNode } from 'react';
import { cn } from '@/utils';

interface PageShellProps {
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  filterSlot?: ReactNode;
  /**
   * By default the filter slot inlines on the same row as the title/actions
   * so compact filter bars don't eat a second row of vertical space.
   * Set to `false` for pages whose filter bar is long or wraps heavily and
   * is better off rendered below the title row.
   */
  filterInline?: boolean;
  children: ReactNode;
  className?: string;
}

export function PageShell({
  title,
  subtitle,
  headerActions,
  filterSlot,
  filterInline = true,
  children,
  className,
}: PageShellProps) {
  const rightSlot = filterInline && filterSlot ? (
    <>
      {filterSlot}
      {headerActions}
    </>
  ) : headerActions;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div
        className="sticky top-0 border-b border-[var(--border-default)] bg-[var(--bg-primary)] pb-2"
        style={{ zIndex: 'var(--z-sticky)' } as React.CSSProperties}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {subtitle}
              </p>
            )}
          </div>
          {rightSlot && (
            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
              {rightSlot}
            </div>
          )}
        </div>
        {!filterInline && filterSlot && <div className="mt-2">{filterSlot}</div>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-3">{children}</div>
    </div>
  );
}
