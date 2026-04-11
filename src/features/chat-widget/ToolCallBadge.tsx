import { useState } from 'react';
import { cn } from '@/utils/cn';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ToolCallBadgeData } from './types';

export function ToolCallBadge({ name, summary, detail, status }: ToolCallBadgeData) {
  const [open, setOpen] = useState(false);
  const canExpand = !!detail && status === 'done';

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setOpen((value) => !value)}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-medium',
          'bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)]',
          canExpand && 'cursor-pointer',
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
        {canExpand && (open ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />)}
      </button>

      {canExpand && open && detail && (
        <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2 text-[11px] text-[var(--text-secondary)]">
          <div>Execution: {detail.executionMs.toFixed(1)} ms</div>
          {typeof detail.rowCount === 'number' && <div>Rows: {detail.rowCount}</div>}
          {typeof detail.cacheHit === 'boolean' && <div>Cache hit: {detail.cacheHit ? 'yes' : 'no'}</div>}
          {detail.error && <div>Error: {detail.error}</div>}
          {detail.sqlUsed && (
            <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-primary)] p-2 text-[10px] text-[var(--text-primary)]">
              <code>{detail.sqlUsed}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
