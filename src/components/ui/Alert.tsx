import { type ReactNode } from 'react';
import { Info, CheckCircle2, AlertTriangle, XCircle, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/utils';

type AlertVariant = 'info' | 'success' | 'warning' | 'error';
export type { AlertVariant };

interface AlertProps {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
  icon?: LucideIcon;
  className?: string;
}

const variantStyles: Record<AlertVariant, { container: string; icon: string; border: string }> = {
  info: {
    container: 'bg-[var(--surface-info)] border-[var(--border-info)]',
    icon: 'text-[var(--color-info)]',
    border: 'border-l-[var(--color-info)]',
  },
  success: {
    container: 'bg-[var(--surface-success)] border-[var(--border-success)]',
    icon: 'text-[var(--color-success)]',
    border: 'border-l-[var(--color-success)]',
  },
  warning: {
    container: 'bg-[var(--surface-warning)] border-[var(--border-warning)]',
    icon: 'text-[var(--color-warning)]',
    border: 'border-l-[var(--color-warning)]',
  },
  error: {
    container: 'bg-[var(--surface-error)] border-[var(--border-error)]',
    icon: 'text-[var(--color-error)]',
    border: 'border-l-[var(--color-error)]',
  },
};

const defaultIcons: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function Alert({ variant, title, children, onDismiss, icon, className }: AlertProps) {
  const styles = variantStyles[variant];
  const IconComponent = icon ?? defaultIcons[variant];

  return (
    <div
      className={cn(
        'relative flex gap-3 rounded-md border border-l-[3px] px-4 py-3',
        styles.container,
        styles.border,
        className
      )}
    >
      <IconComponent className={cn('h-4 w-4 shrink-0 mt-0.5', styles.icon)} />
      <div className="min-w-0 flex-1">
        {title && (
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">
            {title}
          </p>
        )}
        <div className="text-sm text-[var(--text-primary)]">{children}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
