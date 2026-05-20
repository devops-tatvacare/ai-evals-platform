import type { ReactNode } from 'react';
import { cn } from '@/utils';

interface GradientTextProps {
  children: ReactNode;
  className?: string;
}

export function GradientText({ children, className }: GradientTextProps) {
  return (
    <span
      className={cn('bg-clip-text text-transparent', className)}
      style={{ backgroundImage: 'var(--gradient-brand-text)' }}
    >
      {children}
    </span>
  );
}
