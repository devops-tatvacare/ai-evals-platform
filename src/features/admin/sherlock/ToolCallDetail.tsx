import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui';
import type { SherlockPartRow } from '@/services/api/sherlockParts';
import type { ToolPart } from '@/features/sherlock/generated/sherlockContract';

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  completed: 'success',
  error: 'danger',
  running: 'warning',
  pending: 'neutral',
};

interface ToolState {
  status?: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  started_at?: number;
  ended_at?: number;
  error?: { message?: string; [k: string]: unknown } | null;
}

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// started_at/ended_at are monotonic-clock milliseconds, so duration is their
// difference — never a wall-clock parse.
function durationMs(state: ToolState): number | null {
  const { started_at, ended_at } = state;
  if (typeof started_at !== 'number' || typeof ended_at !== 'number') return null;
  return ended_at - started_at;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Read-only tool-call detail body — rendered inside the admin slide-over. */
export function ToolCallDetail({ row }: { row: SherlockPartRow }) {
  const part = row.payload as ToolPart;
  const state = part.state as ToolState;
  const status = state.status ?? 'pending';

  return (
    <div className="flex flex-col gap-4">
      <SummarySection appId={row.appId} status={status} state={state} startedAt={row.createdAt} />
      {state.error ? <ErrorSection error={state.error} /> : null}
      <ArgumentsSection input={state.input ?? null} />
      <OutputSection output={state.output ?? null} />
      <SessionSection sessionId={part.chat_session_id} callId={part.call_id} />
    </div>
  );
}

function SummarySection({
  appId,
  status,
  state,
  startedAt,
}: {
  appId: string;
  status: string;
  state: ToolState;
  startedAt: string;
}) {
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4 py-3 sm:grid-cols-4">
      <Field label="Status">
        <Badge variant={STATUS_VARIANT[status] ?? 'neutral'} size="sm">
          {status}
        </Badge>
      </Field>
      <Field label="Duration">
        <span className="text-sm text-[var(--text-primary)]">{formatMs(durationMs(state))}</span>
      </Field>
      <Field label="Started">
        <span className="text-sm text-[var(--text-primary)]">
          {new Date(startedAt).toLocaleString()}
        </span>
      </Field>
      <Field label="App">
        <span className="text-sm text-[var(--text-primary)]">{appId}</span>
      </Field>
    </section>
  );
}

function ErrorSection({ error }: { error: NonNullable<ToolState['error']> }) {
  const message = typeof error.message === 'string' ? error.message : prettyJson(error);
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

function ArgumentsSection({ input }: { input: Record<string, unknown> | null }) {
  const body = useMemo(() => prettyJson(input), [input]);
  return (
    <Collapsible title="Arguments" defaultOpen>
      <JsonBlock body={body} />
    </Collapsible>
  );
}

function OutputSection({ output }: { output: Record<string, unknown> | null }) {
  if (!output) return null;
  const body = JSON.stringify(output, null, 2);
  return (
    <Collapsible title="Output" defaultOpen={false}>
      <JsonBlock body={body} />
    </Collapsible>
  );
}

function SessionSection({ sessionId, callId }: { sessionId: string | null; callId: string | null }) {
  if (!sessionId && !callId) return null;
  return (
    <Collapsible title="Session" defaultOpen={false}>
      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {sessionId ? (
          <Field label="Session id">
            <span className="font-mono text-xs text-[var(--text-primary)]">{sessionId}</span>
          </Field>
        ) : null}
        {callId ? (
          <Field label="Call id">
            <span className="font-mono text-xs text-[var(--text-primary)]">{callId}</span>
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
