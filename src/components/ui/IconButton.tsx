import { type ButtonHTMLAttributes, forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils';

type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger';
type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  label: string;
  rounded?: 'default' | 'full';
}

const variantStyles: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]',
  secondary: 'bg-[var(--interactive-secondary)] text-[var(--text-primary)] hover:bg-[var(--interactive-secondary-hover)] border border-[var(--border-default)]',
  primary: 'bg-[var(--interactive-primary)] text-[var(--text-on-color)] hover:bg-[var(--interactive-primary-hover)]',
  danger: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-error)] hover:text-[var(--color-error)]',
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

const iconSizeStyles: Record<IconButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-4.5 w-4.5',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: Icon, size = 'md', variant = 'ghost', label, rounded = 'default', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] disabled:pointer-events-none disabled:opacity-50',
          variantStyles[variant],
          sizeStyles[size],
          rounded === 'full' ? 'rounded-full' : 'rounded-md',
          className
        )}
        title={label}
        aria-label={label}
        {...props}
      >
        <Icon className={iconSizeStyles[size]} />
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
