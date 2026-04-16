import { useState } from 'react';
import { AlertCircle, Check, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Shimmer } from './Shimmer';
import type { ToolCallPart } from '../types';

interface ToolItemProps {
  part: ToolCallPart;
  compact?: boolean;
}

export function ToolItem({ part, compact = false }: ToolItemProps) {
  const isExecuting = part.state === 'executing';
  const isError = part.state === 'error';
  const hasDetail = !isExecuting && part.detail != null;
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border transition-colors',
        compact
          ? 'border-transparent'
          : 'border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-secondary)_92%,transparent)]',
        isExecuting && 'border-[color-mix(in_srgb,var(--interactive-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--interactive-primary)_10%,var(--bg-secondary))]',
        isError && 'border-[color-mix(in_srgb,var(--interactive-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_10%,var(--bg-secondary))]',
      )}
    >
      {/* Header row — always visible */}
      <button
        type="button"
        disabled={isExecuting || !hasDetail}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          compact && 'px-0 py-1.5',
          hasDetail && 'cursor-pointer hover:bg-[var(--bg-secondary)]',
        )}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {isExecuting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--interactive-primary)]" />
          ) : isError ? (
            <AlertCircle className="h-3.5 w-3.5 text-[var(--interactive-danger)]" />
          ) : (
            <Check className="h-3.5 w-3.5 text-[var(--color-verdict-pass)]" />
          )}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-primary)]">{part.toolName}</span>
        <span className="ml-auto min-w-0 truncate text-[11px] text-[var(--text-muted)]">
          {isExecuting ? (
            <Shimmer>executing…</Shimmer>
          ) : isError ? (
            part.detail?.error ?? part.summary ?? 'failed'
          ) : (
            part.summary ?? 'done'
          )}
        </span>
        {typeof part.durationMs === 'number' && !isExecuting ? (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
            {Math.round(part.durationMs)}ms
          </span>
        ) : null}
        {hasDetail ? (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform', expanded && 'rotate-90')} />
        ) : null}
      </button>

      {/* Detail panel — inside the same box */}
      {expanded && part.detail ? (
        <div className="border-t border-[var(--border-default)] bg-[var(--bg-primary)]">
          <div className="max-h-[35vh] overflow-y-auto p-3 text-[11px]">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-muted)]">
              {typeof part.detail.executionMs === 'number' ? (
                <span>Time: <strong className="text-[var(--text-primary)]">{Math.round(part.detail.executionMs)}ms</strong></span>
              ) : null}
              {typeof part.detail.rowCount === 'number' ? (
                <span>Rows: <strong className="text-[var(--text-primary)]">{part.detail.rowCount}</strong></span>
              ) : null}
              {part.detail.cacheHit ? (
                <span className="text-[var(--color-verdict-pass)]">cache hit</span>
              ) : null}
            </div>

            {part.detail.error ? (
              <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-[color-mix(in_srgb,var(--interactive-danger)_8%,var(--bg-secondary))] p-2 font-mono text-[10px] text-[var(--interactive-danger)]">
                {part.detail.error}
              </pre>
            ) : null}

            {part.detail.sqlUsed ? (
              <div className="mt-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">SQL</div>
                <pre className="whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 font-mono text-[10px] text-[var(--text-primary)]">
                  {part.detail.sqlUsed}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
