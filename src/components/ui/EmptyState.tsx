import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from './Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; isLoading?: boolean };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-12', className)}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--surface-info)]">
        <Icon className="h-6 w-6 text-[var(--text-brand)]" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-[var(--text-sm)] font-semibold text-[var(--text-primary)]">{title}</p>
        {description && (
          <p className="text-[var(--text-sm)] text-[var(--text-secondary)] max-w-sm">{description}</p>
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
    </div>
  );
}
