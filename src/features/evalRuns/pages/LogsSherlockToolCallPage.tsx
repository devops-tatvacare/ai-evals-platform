import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { useCurrentAppId } from '@/hooks';
import { apiLogsForApp } from '@/config/routes';
import { Badge, EmptyState, LoadingState, PageSurface } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { useToolCall } from '@/features/sherlock/queries/toolCalls';
import type { SherlockToolCallDetail } from '@/services/api/sherlock';

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  success: 'success',
  error: 'danger',
  timeout: 'warning',
};

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Phase 15.1d — sub-route page under `/<app>/logs/sherlock/:toolCallId`.
 * Reads from `GET /api/sherlock/tool-calls/:id` and renders the full row
 * (arguments, generated SQL, validated SQL, error trace, LLM token usage)
 * inside a PageSurface with a "← Sherlock" back button.
 *
 * Components are platform primitives (PageSurface, Badge, EmptyState,
 * LoadingState) plus the same `<pre>` JSON-block / collapsible pattern
 * used by `ActionDetailContent`. The collapsible helper is local — when a
 * third surface needs the same shape, promote it to `src/components/ui/`.
 */
export default function LogsSherlockToolCallPage() {
  const { toolCallId = '' } = useParams<{ toolCallId: string }>();
  const appId = useCurrentAppId();
  const { icon } = usePageMetadata('logs');

  const toolCallQuery = useToolCall(toolCallId || null, { appId });

  const back = {
    to: `${apiLogsForApp(appId)}?type=sherlock`,
    label: 'Sherlock',
  };

  if (toolCallQuery.isLoading) {
    return (
      <PageSurface icon={icon} title="Tool call detail" back={back}>
        <LoadingState />
      </PageSurface>
    );
  }

  if (toolCallQuery.isError || !toolCallQuery.data) {
    return (
      <PageSurface icon={icon} title="Tool call detail" back={back}>
        <EmptyState
          icon={icon}
          title="Tool call not found"
          description={
            (toolCallQuery.error as Error | null)?.message ??
            "The tool call may have been removed, or you don't have access to it."
          }
          fill
        />
      </PageSurface>
    );
  }

  const tc = toolCallQuery.data;
  const subtitle = `${tc.appId} · ${new Date(tc.createdAt).toLocaleString()}`;

  return (
    <PageSurface icon={icon} title={tc.toolName} subtitle={subtitle} back={back} bleed>
      <div className="flex flex-col gap-4 px-5 py-4">
        <SummarySection tc={tc} />
        {tc.errorMessage ? <ErrorSection message={tc.errorMessage} /> : null}
        <ArgumentsSection tc={tc} />
        <SqlSections tc={tc} />
        <SessionSection tc={tc} />
      </div>
    </PageSurface>
  );
}

function SummarySection({ tc }: { tc: SherlockToolCallDetail }) {
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-3 sm:grid-cols-3 lg:grid-cols-4">
      <Field label="Status">
        <Badge variant={STATUS_VARIANT[tc.status] ?? 'neutral'} size="sm">
          {tc.status}
        </Badge>
      </Field>
      <Field label="Duration">
        <span className="text-sm text-[var(--text-primary)]">{formatMs(tc.executionMs)}</span>
      </Field>
      <Field label="Rows">
        <span className="text-sm text-[var(--text-primary)]">{tc.rowCount ?? '—'}</span>
      </Field>
      <Field label="Cache hit">
        <span className="text-sm text-[var(--text-primary)]">
          {tc.cacheHit === null ? '—' : tc.cacheHit ? 'Yes' : 'No'}
        </span>
      </Field>
      <Field label="LLM model">
        <span className="text-sm text-[var(--text-primary)]">{tc.llmModel ?? '—'}</span>
      </Field>
      <Field label="Tokens in">
        <span className="text-sm text-[var(--text-primary)]">{tc.llmTokensIn ?? '—'}</span>
      </Field>
      <Field label="Tokens out">
        <span className="text-sm text-[var(--text-primary)]">{tc.llmTokensOut ?? '—'}</span>
      </Field>
      <Field label="App">
        <span className="text-sm text-[var(--text-primary)]">{tc.appId}</span>
      </Field>
    </section>
  );
}

function ErrorSection({ message }: { message: string }) {
  return (
    <section className="rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-error)]">
        Error
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-error)]">
        {message}
      </pre>
    </section>
  );
}

function ArgumentsSection({ tc }: { tc: SherlockToolCallDetail }) {
  const body = useMemo(() => prettyJson(tc.arguments ?? null), [tc.arguments]);
  return (
    <Collapsible title="Arguments" defaultOpen>
      <JsonBlock body={body} />
    </Collapsible>
  );
}

function SqlSections({ tc }: { tc: SherlockToolCallDetail }) {
  if (!tc.generatedSql && !tc.validatedSql) return null;
  return (
    <Collapsible title="SQL" defaultOpen={false}>
      <div className="space-y-3">
        {tc.generatedSql ? <SqlBlock title="Generated" body={tc.generatedSql} /> : null}
        {tc.validatedSql ? <SqlBlock title="Validated" body={tc.validatedSql} /> : null}
      </div>
    </Collapsible>
  );
}

function SessionSection({ tc }: { tc: SherlockToolCallDetail }) {
  if (!tc.sessionId && !tc.dbSessionId) return null;
  return (
    <Collapsible title="Session" defaultOpen={false}>
      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {tc.sessionId ? (
          <Field label="Session id">
            <span className="font-mono text-xs text-[var(--text-primary)]">{tc.sessionId}</span>
          </Field>
        ) : null}
        {tc.dbSessionId ? (
          <Field label="DB session id">
            <span className="font-mono text-xs text-[var(--text-primary)]">{tc.dbSessionId}</span>
          </Field>
        ) : null}
      </dl>
    </Collapsible>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Collapsible({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </section>
  );
}

function JsonBlock({ body }: { body: string }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
      {body}
    </pre>
  );
}

function SqlBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {title}
      </div>
      <pre className="max-h-[300px] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
        {body}
      </pre>
    </div>
  );
}
