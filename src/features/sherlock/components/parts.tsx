/** Styled per-arm components for the SherlockPart union. */
import { useState } from 'react';
import { AlertCircle, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/utils/cn';
import { ChatChartCard } from '@/features/chat-widget/components/ChatChartCard';
import { CompactionSeparator } from '@/features/chat-widget/components/CompactionSeparator';
import { Shimmer } from '@/features/chat-widget/components/Shimmer';
import type { ChartPayload } from '@/features/chat-widget/generated/chartContract';

import { MAX_SPECIALIST_ATTEMPTS } from '../limits';
import type {
  AssistantTextPart,
  ChartPart,
  CompactionPart,
  ErrorPart,
  EvidencePart,
  ReasoningPart,
  RetryPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  ToolPart,
  UserMessagePart,
} from '../generated/sherlockContract';

type PartOf<T> = { part: T };

interface ChartContext {
  appId: string;
  sessionId: string | null;
}

const SPECIALIST_LABELS: Record<string, string> = {
  data_specialist: 'data specialist',
  query_synthesis_specialist: 'query synthesis',
  authoring_specialist: 'authoring specialist',
};

function specialistLabel(name: string): string {
  return SPECIALIST_LABELS[name] ?? name.replace(/_/g, ' ');
}

// ── user message ────────────────────────────────────────────────────────────

export function UserMessage({ part }: PartOf<UserMessagePart>) {
  return (
    <div
      className="flex justify-end"
      data-part-type="user_message"
      data-part-id={part.id}
    >
      <div className="max-w-[80%] rounded-2xl bg-[var(--bg-secondary)] px-4 py-2 text-[13px] text-[var(--text-primary)] whitespace-pre-wrap break-words">
        {part.text}
      </div>
    </div>
  );
}

// ── subtask (supervisor → specialist dispatch) ──────────────────────────────

export function SubagentBadge({ part }: PartOf<SubtaskPart>) {
  return (
    <div
      className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
      data-part-type="subtask"
      data-part-id={part.id}
      data-specialist={part.specialist}
      data-call-id={part.call_id}
    >
      <Shimmer>
        <Loader2 className="h-3 w-3 animate-spin" />
      </Shimmer>
      <span className="font-mono uppercase tracking-[0.08em]">
        {specialistLabel(part.specialist)}
      </span>
    </div>
  );
}

// ── tool chip ───────────────────────────────────────────────────────────────

export function ToolChip({ part }: PartOf<ToolPart>) {
  const status = part.state.status;
  const isError = status === 'error';
  return (
    <div
      className={cn(
        'relative pl-3.5 py-1',
        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px',
        isError
          ? 'before:bg-[var(--interactive-danger)]'
          : status === 'pending' || status === 'running'
            ? 'before:bg-[var(--interactive-primary)]'
            : 'before:bg-[var(--border-default)]',
      )}
      data-part-type="tool"
      data-part-id={part.id}
      data-call-id={part.call_id}
      data-tool={part.tool}
      data-status={status}
    >
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        {status === 'pending' || status === 'running' ? (
          <Loader2 className="h-3 w-3 animate-spin text-[var(--interactive-primary)]" />
        ) : null}
        <span className="font-mono uppercase tracking-[0.08em]">{part.tool}</span>
        {isError ? (
          <span className="text-[var(--interactive-danger)]">
            Couldn&apos;t run that query
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── retry pill ──────────────────────────────────────────────────────────────

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
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-0.5">{children}</ol>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isBlock = Boolean(className?.startsWith('language-'));
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code className="font-mono text-xs rounded px-1.5 py-0.5 bg-[var(--bg-code)] border border-[var(--border-code)]">
        {children}
      </code>
    );
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
  const payload = part.artifact.payload as unknown as ChartPayload;
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

// ── evidence (sources) ──────────────────────────────────────────────────────

export function EvidenceRefs({ part }: PartOf<EvidencePart>) {
  const refs = part.refs ?? [];
  const [expanded, setExpanded] = useState(false);
  if (refs.length === 0) return null;
  return (
    <div
      className="text-[11px] text-[var(--text-muted)]"
      data-part-type="evidence"
      data-part-id={part.id}
      data-ref-count={refs.length}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight className={cn('h-2.5 w-2.5 transition-transform', expanded && 'rotate-90')} />
        <span className="font-mono uppercase tracking-[0.08em]">Sources · {refs.length}</span>
      </button>
      {expanded ? (
        <ul className="mt-1 space-y-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          {refs.map((ref, i) => {
            const locator = (ref.locator ?? {}) as Record<string, unknown>;
            const rowIndex =
              typeof locator.row_index === 'number' ? locator.row_index + 1 : i + 1;
            const total =
              typeof locator.row_count === 'number' ? locator.row_count : refs.length;
            return (
              <li key={ref.ref_id ?? i} className="font-mono">
                Row {rowIndex} of {total}
              </li>
            );
          })}
        </ul>
      ) : null}
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

// ── step markers (admin only) ───────────────────────────────────────────────

export function StepStartMarker({ part }: PartOf<StepStartPart>) {
  return (
    <div
      data-part-type="step_start"
      data-part-id={part.id}
      data-turn-id={part.turn_id}
      className="h-px bg-[var(--border-subtle)]"
    />
  );
}

export function StepFinishMarker({ part }: PartOf<StepFinishPart>) {
  return (
    <div
      data-part-type="step_finish"
      data-part-id={part.id}
      data-turn-id={part.turn_id}
      data-status={part.status}
      className="h-px bg-[var(--border-subtle)]"
    />
  );
}
