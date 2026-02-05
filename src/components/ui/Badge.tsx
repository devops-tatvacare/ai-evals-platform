import { type ReactNode } from 'react';
import { cn } from '@/utils';

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'error' | 'warning' | 'info' | 'danger' | 'default' | 'destructive';
export type { BadgeVariant };

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
  default: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
  primary: 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]',
  success: 'bg-[var(--color-success-light)] text-[var(--color-success)]',
  error: 'bg-[var(--color-error-light)] text-[var(--color-error)]',
  destructive: 'bg-[var(--color-error-light)] text-[var(--color-error)]',
  warning: 'bg-[var(--color-warning-light)] text-[var(--color-warning)]',
  info: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
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
