import { type ReactNode } from 'react';
import { cn } from '@/utils';

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'error' | 'warning' | 'info' | 'danger';
export type { BadgeVariant };

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
  primary: 'bg-[var(--color-brand-accent)]/20 text-[var(--color-brand-primary)]',
  success: 'bg-[var(--color-success-light)] text-[var(--color-success)]',
  error: 'bg-[var(--color-error-light)] text-[var(--color-error)]',
  warning: 'bg-[var(--color-warning-light)] text-[var(--color-warning)]',
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  danger: 'bg-[var(--color-error-light)] text-[var(--color-error)]',
};

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-[4px] px-2 text-[11px] font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
