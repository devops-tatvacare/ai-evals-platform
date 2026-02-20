import { type ReactNode } from 'react';
import { cn } from '@/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  hoverable?: boolean;
}

export function Card({ children, className, onClick, active, hoverable = true }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-[6px] border bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-sm)]',
        'border-[var(--border-subtle)]',
        hoverable && 'transition-shadow hover:shadow-[var(--shadow-default)]',
        onClick && 'cursor-pointer',
        active && 'border-[var(--border-brand)] bg-[var(--color-brand-accent)]/10',
        className
      )}
    >
      {children}
    </div>
  );
}
