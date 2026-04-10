import { cn } from '@/utils/cn';
import { Check } from 'lucide-react';
import type { ToolCallBadgeData } from './types';

export function ToolCallBadge({ name, summary, status }: ToolCallBadgeData) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-medium',
        'bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)]',
      )}
    >
      {status === 'running' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand-primary)] animate-pulse" />
      ) : (
        <Check className="h-2.5 w-2.5" />
      )}
      {name}
      {summary && <span className="text-[var(--text-muted)]">&middot; {summary}</span>}
      {status === 'running' && <span className="text-[var(--text-muted)]">running&hellip;</span>}
    </span>
  );
}
