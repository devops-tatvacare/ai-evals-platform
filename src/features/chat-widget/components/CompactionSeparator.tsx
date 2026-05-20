import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CompactionPart } from '../types';

interface CompactionSeparatorProps {
  part: CompactionPart;
}

/**
 * Full-width "Session compacted" separator rendered in the message
 * stream when the Responses API summarizes earlier turns server-side.
 *
 * Layout (solid 1px rules, not dashed — per design):
 *
 *   ─────────────  Session compacted  ─────────────
 *           [▸ View summary captured (N tok)]
 *
 * The summary is hidden by default; the expander toggles a small body
 * underneath. Tokens-before is shown only when the server surfaces it
 * (some Responses API paths omit it). Solid neutral border, no brand
 * color — this is a system event, not a user action.
 */
export function CompactionSeparator({ part }: CompactionSeparatorProps) {
  const [expanded, setExpanded] = useState(false);
  const hasSummary = part.summary.trim().length > 0;
  const tokensLabel =
    typeof part.tokensBefore === 'number'
      ? `${formatTokens(part.tokensBefore)} tok`
      : null;

  return (
    <div className="flex flex-col items-stretch gap-1 py-1">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border-default)]" />
        <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Session compacted
        </span>
        <div className="h-px flex-1 bg-[var(--border-default)]" />
      </div>

      {hasSummary ? (
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
              'font-mono text-[10.5px] text-[var(--text-muted)]',
              'hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
              'transition-colors',
              'focus-visible:outline-none focus-visible:ring-1',
              'focus-visible:ring-[var(--color-brand-accent)]',
            )}
            aria-expanded={expanded}
          >
            <ChevronRight
              className={cn(
                'h-2.5 w-2.5 transition-transform',
                expanded && 'rotate-90',
              )}
            />
            {expanded ? 'Hide summary' : 'View summary'}
            {tokensLabel ? (
              <span className="ml-1 text-[var(--text-muted)]">
                · {tokensLabel}
              </span>
            ) : null}
          </button>
          {expanded ? (
            <div
              className={cn(
                'mt-1 w-full rounded-md border border-[var(--border-subtle)]',
                'bg-[var(--bg-secondary)] px-3 py-2',
                'text-[11px] leading-relaxed text-[var(--text-secondary)]',
                'whitespace-pre-wrap break-words',
              )}
            >
              {part.summary}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
