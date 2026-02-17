import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils';
import { Button } from './Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; isLoading?: boolean };
  /** Custom content rendered below the description (alternative to `action`) */
  children?: ReactNode;
  className?: string;
  /** Compact variant with smaller icon and less padding — for tables & inline sections */
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, children, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 border border-dashed border-[var(--border-default)] rounded-lg',
        compact ? 'py-6 px-4' : 'py-10 px-6',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-[var(--surface-info)]',
          compact ? 'h-10 w-10' : 'h-14 w-14',
        )}
      >
        <Icon className={cn('text-[var(--text-brand)]', compact ? 'h-4 w-4' : 'h-5.5 w-5.5')} />
      </div>
      <div className="text-center space-y-1">
        <p className={cn('font-semibold text-[var(--text-primary)]', compact ? 'text-xs' : 'text-sm')}>
          {title}
        </p>
        {description && (
          <p className={cn('text-[var(--text-secondary)] max-w-sm', compact ? 'text-xs' : 'text-sm')}>
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button
          variant="primary"
          size="sm"
          onClick={action.onClick}
          isLoading={action.isLoading}
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  );
}
