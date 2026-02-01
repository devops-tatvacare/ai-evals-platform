import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, error, type, ...props }, ref) => {
    return (
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
            {icon}
          </div>
        )}
        <input
          type={type}
          ref={ref}
          className={cn(
            'h-9 w-full rounded-[6px] border bg-[var(--bg-primary)] px-3 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors',
            'border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
            icon && 'pl-10',
            error && 'border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-[var(--color-error)]/50',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-[11px] text-[var(--color-error)]">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
