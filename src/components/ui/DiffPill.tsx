import type { ReactNode } from 'react';
import { cn } from '@/utils';

export type DiffPillKind = 'changed' | 'same' | 'new' | 'initial';

interface DiffPillProps {
  kind: DiffPillKind;
  children: ReactNode;
  className?: string;
}

const kindStyles: Record<DiffPillKind, string> = {
  changed: 'bg-[var(--surface-warning)] text-[var(--color-warning-dark)] border-[var(--border-warning)]',
  same: 'bg-[var(--surface-success)] text-[var(--color-success-dark)] border-[var(--border-success)]',
  new: 'bg-[var(--surface-info)] text-[var(--color-info-dark)] border-[var(--border-info)]',
  initial: 'bg-[var(--surface-neutral)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
};

// "Changed from previous review" pill used by the History tab. Maps onto
// existing surface tokens; no new color palette.
export function DiffPill({ kind, children, className }: DiffPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[11px] font-medium',
        kindStyles[kind],
        className,
      )}
    >
      {children}
    </span>
  );
}
