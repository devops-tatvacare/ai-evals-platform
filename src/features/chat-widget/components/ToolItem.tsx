import { useState } from 'react';
import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Shimmer } from './Shimmer';
import { SqlBlock } from './SqlBlock';
import type { ToolCallPart } from '../types';

interface ToolItemProps {
  part: ToolCallPart;
  compact?: boolean;
}

const SPECIALIST_LABELS: Record<string, string> = {
  data_specialist: 'data specialist',
  retrieval_specialist: 'retrieval specialist',
  action_specialist: 'action specialist',
};

function formatDuration(ms?: number): string | null {
  if (typeof ms !== 'number' || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function specialistLabel(name: string): string {
  return SPECIALIST_LABELS[name] ?? name.replace(/_/g, ' ');
}

export function ToolItem({ part }: ToolItemProps) {
  const isExecuting = part.state === 'executing';
  const isError = part.state === 'error';
  const expandable = !isExecuting && (Boolean(part.detail) || Boolean(part.routing?.attemptedSql));
  const [expanded, setExpanded] = useState(false);

  const label = specialistLabel(part.toolName);
  const duration = formatDuration(part.durationMs);
  const projectedTable = part.routing?.projectedTables?.[0];
  const tablesCount = part.routing?.projectedTables?.length;
  const intentClass = part.routing?.intentClass;
  const rowCount = part.rowCount;
  const evidenceCount = part.evidenceCount;
  const briefSummary = (part.briefSummary || '').trim();

  const metaSegments: string[] = [];
  if (projectedTable) {
    metaSegments.push(tablesCount && tablesCount > 1 ? `${projectedTable} +${tablesCount - 1}` : projectedTable);
  }
  if (typeof rowCount === 'number') metaSegments.push(`${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`);
  if (evidenceCount) metaSegments.push(`${evidenceCount} evidence`);
  if (intentClass) metaSegments.push(intentClass);

  return (
    <div
      className={cn(
        'group relative pl-3.5',
        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px',
        isError ? 'before:bg-[var(--interactive-danger)]' : 'before:bg-[var(--border-default)]',
        isExecuting && 'before:bg-[var(--interactive-primary)]',
      )}
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setExpanded((v) => !v)}
        className={cn(
          'block w-full py-1.5 text-left',
          expandable && 'cursor-pointer',
        )}
      >
        {/* Title row: status glyph + agent label · narrative + duration on right */}
        <span className="flex items-baseline gap-2 text-[12px]">
          <StatusGlyph executing={isExecuting} error={isError} />
          <span className={cn(
            'font-mono text-[11px] uppercase tracking-[0.08em]',
            isError ? 'text-[var(--interactive-danger)]' : 'text-[var(--text-secondary)]',
          )}>
            {label}
          </span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="min-w-0 flex-1 text-[var(--text-primary)]">
            {isExecuting ? (
              <Shimmer>consulting…</Shimmer>
            ) : isError ? (
              <>consultation failed</>
            ) : (
              <>consulted</>
            )}
          </span>
          {duration && !isExecuting ? (
            <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">{duration}</span>
          ) : null}
          {expandable ? (
            <ChevronRight className={cn('h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform', expanded && 'rotate-90')} />
          ) : null}
        </span>

        {/* Brief summary — only while running or on error (when no meta yet) */}
        {briefSummary && (isExecuting || isError) ? (
          <span className="mt-0.5 block pl-[18px] text-[11px] italic text-[var(--text-muted)] line-clamp-2">
            {briefSummary}
          </span>
        ) : null}

        {/* Meta: dot-separated technical fields, monospace */}
        {!isExecuting && metaSegments.length > 0 ? (
          <span className="mt-0.5 block pl-[18px] font-mono text-[10.5px] text-[var(--text-muted)]">
            {metaSegments.map((seg, i) => (
              <span key={i}>
                {i > 0 ? <span className="mx-1.5 text-[var(--border-default)]">·</span> : null}
                <span className={cn(i === 0 && 'text-[var(--text-secondary)]')}>{seg}</span>
              </span>
            ))}
          </span>
        ) : null}
      </button>

      {/* Expanded detail panel — shows routing + SQL */}
      {expanded && expandable ? (
        <div className="mb-1 ml-[18px] mt-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2.5">
          {part.routing ? (
            <dl className="mb-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-[10.5px]">
              {part.routing.intentClass ? (
                <>
                  <dt className="text-[var(--text-muted)]">intent</dt>
                  <dd className="text-[var(--text-primary)]">{part.routing.intentClass}</dd>
                </>
              ) : null}
              {part.routing.allowedLayers?.length ? (
                <>
                  <dt className="text-[var(--text-muted)]">layers</dt>
                  <dd className="text-[var(--text-primary)]">{part.routing.allowedLayers.join(', ')}</dd>
                </>
              ) : null}
              {part.routing.projectedTables?.length ? (
                <>
                  <dt className="text-[var(--text-muted)]">tables</dt>
                  <dd className="text-[var(--text-primary)]">{part.routing.projectedTables.join(', ')}</dd>
                </>
              ) : null}
              {part.routing.chartPayloadKind ? (
                <>
                  <dt className="text-[var(--text-muted)]">result</dt>
                  <dd className="text-[var(--text-primary)]">{part.routing.chartPayloadKind}</dd>
                </>
              ) : null}
              {part.routing.executionStatus && part.routing.executionStatus !== 'ok' ? (
                <>
                  <dt className="text-[var(--text-muted)]">execution</dt>
                  <dd className="text-[var(--interactive-danger)]">{part.routing.executionStatus}</dd>
                </>
              ) : null}
            </dl>
          ) : null}

          {part.detail?.error ? (
            <pre className="mb-2 whitespace-pre-wrap break-words rounded bg-[color-mix(in_srgb,var(--interactive-danger)_8%,var(--bg-primary))] p-2 font-mono text-[10.5px] text-[var(--interactive-danger)]">
              {part.detail.error}
            </pre>
          ) : null}

          {part.routing?.attemptedSql || part.detail?.sqlUsed ? (
            <SqlBlock sql={(part.routing?.attemptedSql ?? part.detail?.sqlUsed) as string} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusGlyph({ executing, error }: { executing: boolean; error: boolean }) {
  if (executing) {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--interactive-primary)]" />;
  }
  if (error) {
    return <AlertCircle className="h-3 w-3 shrink-0 text-[var(--interactive-danger)]" />;
  }
  return <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-[var(--color-verdict-pass)]" />;
}
