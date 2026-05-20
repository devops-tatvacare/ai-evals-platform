/** Styled content components for the SherlockPart union (specialist runs render
 *  via SpecialistGroup; turn framing via TurnList). */
import { useState } from 'react';
import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/utils/cn';
import { ChatChartCard } from '@/features/chat-widget/components/ChatChartCard';
import { CompactionSeparator } from '@/features/chat-widget/components/CompactionSeparator';
import type { ChartPayload } from '@/features/chat-widget/generated/chartContract';

import { MAX_SPECIALIST_ATTEMPTS } from '../limits';
import type {
  AssistantTextPart,
  ChartPart,
  CompactionPart,
  ErrorPart,
  ReasoningPart,
  RetryPart,
} from '../generated/sherlockContract';

type PartOf<T> = { part: T };

interface ChartContext {
  appId: string;
  sessionId: string | null;
}

// ── retry pill (standalone; SpecialistGroup folds retries into its rows) ─────

export function RetryPill({ part }: PartOf<RetryPart>) {
  const reachedCap = part.attempt_number > MAX_SPECIALIST_ATTEMPTS;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-[11px] font-medium',
        reachedCap
          ? 'border-[var(--interactive-danger)] text-[var(--interactive-danger)]'
          : 'border-[var(--border-default)] text-[var(--text-secondary)]',
      )}
      data-part-type="retry"
      data-part-id={part.id}
      data-specialist={part.specialist}
      data-attempt={part.attempt_number}
    >
      <RefreshCw className="h-3 w-3" />
      {reachedCap
        ? `Gave up after ${MAX_SPECIALIST_ATTEMPTS} attempts`
        : `Trying again (attempt ${part.attempt_number} of ${MAX_SPECIALIST_ATTEMPTS})`}
    </div>
  );
}

// ── assistant text (streaming markdown) ─────────────────────────────────────

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-[15px] font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[14px] font-semibold mt-2 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-[13px] font-semibold mt-2 mb-1 first:mt-0">{children}</h4>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="text-[12px] font-semibold uppercase tracking-wide mt-2 mb-1 first:mt-0 text-[var(--text-secondary)]">{children}</h5>
  ),
  h6: ({ children }: { children?: React.ReactNode }) => (
    <h6 className="text-[11px] font-semibold uppercase tracking-wide mt-2 mb-1 first:mt-0 text-[var(--text-muted)]">{children}</h6>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed marker:text-[var(--text-muted)] has-[>input[type=checkbox]]:list-none has-[>input[type=checkbox]]:-ml-5">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  del: ({ children }: { children?: React.ReactNode }) => (
    <del className="line-through text-[var(--text-muted)]">{children}</del>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--text-brand)] hover:underline">
      {children}
    </a>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isBlock = Boolean(className?.startsWith('language-'));
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code className="font-mono text-xs rounded px-1.5 py-0.5 bg-[var(--bg-code)] border border-[var(--border-code)] text-[var(--text-primary)]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-3 rounded-lg bg-[var(--bg-code-block)] border border-[var(--border-code)] p-3 text-xs overflow-x-auto last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-[var(--border-default)] pl-3 text-[var(--text-muted)] italic last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-0 border-t border-[var(--border-subtle)]" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse border border-[var(--border-default)] text-xs">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-[var(--border-default)] px-2.5 py-1.5 align-top even:bg-[var(--bg-secondary)]">
      {children}
    </td>
  ),
  input: ({ type, checked, ...props }: { type?: string; checked?: boolean }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          readOnly
          className="mr-1.5 align-middle accent-[var(--interactive-primary)]"
          {...props}
        />
      );
    }
    return <input type={type} {...props} />;
  },
};

export function AssistantMarkdown({ part }: PartOf<AssistantTextPart>) {
  const text = part.text ?? '';
  return (
    <div
      className="text-[13px] text-[var(--text-primary)]"
      data-part-type="assistant_text"
      data-part-id={part.id}
      data-final={part.final}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ── reasoning ───────────────────────────────────────────────────────────────

export function ReasoningBlock({ part }: PartOf<ReasoningPart>) {
  const [expanded, setExpanded] = useState(false);
  const text = part.text ?? '';
  if (!text.trim()) return null;
  return (
    <div
      className="text-[11px] text-[var(--text-muted)]"
      data-part-type="reasoning"
      data-part-id={part.id}
      data-final={part.final}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight className={cn('h-2.5 w-2.5 transition-transform', expanded && 'rotate-90')} />
        <span className="font-mono uppercase tracking-[0.08em]">reasoning</span>
      </button>
      {expanded ? (
        <div className="mt-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 whitespace-pre-wrap break-words leading-relaxed">
          {text}
        </div>
      ) : null}
    </div>
  );
}

// ── chart card (delegates to existing widget primitive) ─────────────────────

export function ChartCard({ part, appId, sessionId }: PartOf<ChartPart> & ChartContext) {
  // Both the sherlock Artifact payload and the widget ChartPayload are codegen'd
  // from the same backend Pydantic ChartPayload union — structurally identical,
  // nominally distinct across the two generated modules.
  const payload: ChartPayload = part.artifact.payload;
  return (
    <div data-part-type="chart" data-part-id={part.id} data-artifact-kind={part.artifact.kind}>
      <ChatChartCard
        part={{ type: 'chart', payload }}
        appId={appId}
        sessionId={sessionId}
      />
    </div>
  );
}

// ── error banner ────────────────────────────────────────────────────────────

export function ErrorBanner({ part }: PartOf<ErrorPart>) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--interactive-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_8%,var(--bg-primary))] px-3 py-2 text-[12px] text-[var(--text-primary)]"
      data-part-type="error"
      data-part-id={part.id}
      data-source={part.source}
      data-recoverable={part.recoverable}
      role="alert"
    >
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--interactive-danger)]" />
      <span className="whitespace-pre-wrap break-words leading-relaxed">{part.message}</span>
    </div>
  );
}

// ── compaction (reuse existing separator) ───────────────────────────────────

export function CompactionMarker({ part }: PartOf<CompactionPart>) {
  return (
    <div data-part-type="compaction" data-part-id={part.id}>
      <CompactionSeparator
        part={{
          type: 'compaction',
          summary: part.summary ?? '',
          tokensBefore: part.tokens_before ?? null,
          occurredAt: new Date(part.created_at).toISOString(),
        }}
      />
    </div>
  );
}
