import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils';
import type { StatusDotStatus } from './StatusDot';

type BadgeVariant = 'neutral' | 'primary' | 'success' | 'error' | 'warning' | 'info' | 'danger' | 'default' | 'destructive';
export type { BadgeVariant };

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: StatusDotStatus;
  icon?: LucideIcon;
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

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'h-5 px-2 text-[11px]',
  md: 'h-6 px-2.5 text-[12px]',
};

const dotColors: Record<StatusDotStatus, string> = {
  success: 'bg-[var(--color-success)]',
  error: 'bg-[var(--color-error)]',
  warning: 'bg-[var(--color-warning)]',
  info: 'bg-[var(--color-info)]',
  neutral: 'bg-[var(--text-muted)]',
  running: 'bg-[var(--color-info)]',
};

export function Badge({ children, variant = 'neutral', size = 'sm', dot, icon: Icon, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[4px] font-medium',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotColors[dot])} />
      )}
      {Icon && (
        <Icon className="h-3 w-3 shrink-0" />
      )}
      {children}
    </span>
  );
}
