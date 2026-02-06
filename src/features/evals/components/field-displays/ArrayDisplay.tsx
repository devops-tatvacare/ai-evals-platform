import { cn } from '@/utils';
import type { ArrayItemSchema } from '@/types';

interface ArrayDisplayProps {
  value: unknown;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema?: ArrayItemSchema;
  compact?: boolean;
  className?: string;
}

export function ArrayDisplay({ value, compact = false, className }: ArrayDisplayProps) {
  if (value === null || value === undefined) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        —
      </div>
    );
  }

  if (!Array.isArray(value)) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        Invalid array
      </div>
    );
  }

  if (value.length === 0) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        (empty)
      </div>
    );
  }

  // Check if array contains objects or primitives
  const firstItem = value[0];
  const isObjectArray = typeof firstItem === 'object' && firstItem !== null;

  // Compact mode: show count only
  if (compact) {
    return (
      <div className={cn('text-sm text-[var(--text-primary)]', className)}>
        {value.length} {value.length === 1 ? 'item' : 'items'}
      </div>
    );
  }

  // Full display mode
  if (isObjectArray) {
    // Format as JSON
    return (
      <div className={cn('text-xs font-mono', className)}>
        <pre className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md p-3 overflow-x-auto text-[var(--text-primary)]">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  } else {
    // Primitive array - show as comma-separated list
    return (
      <div className={cn('text-sm text-[var(--text-primary)]', className)}>
        {value.map(String).join(', ')}
      </div>
    );
  }
}
