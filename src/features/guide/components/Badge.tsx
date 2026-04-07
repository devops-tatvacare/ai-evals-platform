import { cn } from '@/utils/cn';
import type { ReactNode } from 'react';

const colorStyles: Record<string, string> = {
  blue: 'bg-[var(--surface-info)] text-[var(--color-info)]',
  green: 'bg-[var(--surface-success)] text-[var(--color-success)]',
  purple: 'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]',
  amber: 'bg-[var(--surface-warning)] text-[var(--color-warning)]',
  red: 'bg-[var(--surface-error)] text-[var(--color-error)]',
};

interface BadgeProps {
  color: 'blue' | 'green' | 'purple' | 'amber' | 'red';
  children: ReactNode;
}

export default function Badge({ color, children }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', colorStyles[color] ?? colorStyles.blue)}>
      {children}
    </span>
  );
}
