import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type { ButtonVariant };
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--interactive-primary)] text-white hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]',
  secondary: 'bg-[var(--interactive-secondary)] text-[var(--text-primary)] hover:bg-[var(--interactive-secondary-hover)] border border-[var(--border-default)]',
  ghost: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]',
  danger: 'bg-[var(--color-error)] text-white hover:bg-red-600 active:bg-red-700',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-[13px]',
  md: 'h-8 px-3 text-[13px]',
  lg: 'h-9 px-4 text-[14px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-[6px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] disabled:pointer-events-none disabled:opacity-50',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
