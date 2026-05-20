import { Search } from 'lucide-react';
import { cn } from '@/utils/cn';
import { hasBrowsableResults, type AnyRunStatus } from '@/utils/runLifecycle';

interface Props {
  status: AnyRunStatus;
  resultCount: number;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Status- and count-gated search input. Renders nothing on active runs and
 * on terminal runs with zero results — there is nothing to search.
 */
export function RunResultsSearch({
  status,
  resultCount,
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: Props) {
  if (!hasBrowsableResults(status, resultCount)) return null;

  return (
    <div className={cn('relative max-w-sm', className)}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
      />
    </div>
  );
}
