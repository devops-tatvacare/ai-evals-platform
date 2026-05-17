import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface Props {
  /**
   * Card content — typically `<StatPill>` instances, but any node works.
   * The wrapper owns the grid layout and spacing so every entry's metric
   * row reads consistently.
   */
  children: ReactNode;
  /**
   * Optional override for the responsive column count. Defaults to
   * `grid-cols-2 md:grid-cols-4` which matches the existing run-detail
   * surfaces; pass a different class string to fit denser metric rows.
   */
  columnsClassName?: string;
  className?: string;
}

/**
 * Uniform grid wrapper for the run-detail metric/stat row. Owns only the
 * layout — callers supply the actual cards. Phase 2 will collapse this into
 * a descriptor-driven API once each renderer is responsible for its own
 * card array.
 */
export function RunMetricCards({
  children,
  columnsClassName = 'grid-cols-2 md:grid-cols-4',
  className,
}: Props) {
  return (
    <div className={cn('grid gap-3', columnsClassName, className)}>
      {children}
    </div>
  );
}
