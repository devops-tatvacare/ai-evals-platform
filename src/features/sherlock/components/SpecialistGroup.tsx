/** Collapsible per-turn specialist-consultation block.
 *  Reads each SubtaskPart's lifecycle state directly — no stitching, no
 *  inference. One row per dispatch; retries thread onto their specialist. */
import { useState } from 'react';
import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react';

import { cn } from '@/utils/cn';
import { Shimmer } from '@/features/chat-widget/components/Shimmer';

import { MAX_SPECIALIST_ATTEMPTS } from '../limits';
import type {
  RetryPart,
  SpecialistBrief,
  SubtaskPart,
  SubtaskResult,
} from '../generated/sherlockContract';

export type SpecialistPart = SubtaskPart | RetryPart;

type Status = 'running' | 'completed' | 'error';

const SPECIALIST_LABELS: Record<string, string> = {
  data_specialist: 'data specialist',
  query_synthesis_specialist: 'query synthesis',
  authoring_specialist: 'authoring specialist',
};

function specialistLabel(name: string): string {
  return SPECIALIST_LABELS[name] ?? name.replace(/_/g, ' ');
}

interface Consultation {
  key: string;
  specialist: string;
  brief?: SpecialistBrief;
  subtask: SubtaskPart;
  retries: RetryPart[];
}

// One consultation per subtask dispatch; retries (which carry no call_id)
// thread onto the most recent dispatch of the same specialist.
function buildConsultations(parts: SpecialistPart[]): Consultation[] {
  const consultations: Consultation[] = [];
  const lastBySpecialist = new Map<string, Consultation>();
  for (const part of parts) {
    if (part.type === 'subtask') {
      const c: Consultation = {
        key: part.id,
        specialist: part.specialist,
        brief: part.brief,
        subtask: part,
        retries: [],
      };
      consultations.push(c);
      lastBySpecialist.set(part.specialist, c);
    } else if (part.type === 'retry') {
      const target = lastBySpecialist.get(part.specialist) ?? consultations[consultations.length - 1];
      if (target) target.retries.push(part);
    }
  }
  return consultations;
}

// Honest backend state. A pre-lifecycle subtask (state absent) resolves with
// the turn rather than spinning forever.
function consultationStatus(c: Consultation, settled: boolean): Status {
  const status = c.subtask.state?.status;
  if (status === 'completed') return 'completed';
  if (status === 'error') return 'error';
  return settled ? 'completed' : 'running';
}

function completedResult(c: Consultation): SubtaskResult | null {
  const state = c.subtask.state;
  return state?.status === 'completed' ? state.result : null;
}

function errorText(c: Consultation): string | null {
  const state = c.subtask.state;
  return state?.status === 'error' ? state.error ?? null : null;
}

function durationMs(c: Consultation): number | null {
  const state = c.subtask.state;
  if (state && (state.status === 'completed' || state.status === 'error')) {
    if (typeof state.started_at === 'number' && typeof state.ended_at === 'number') {
      return Math.max(0, state.ended_at - state.started_at);
    }
  }
  return null;
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatusGlyph({ status }: { status: Status }) {
  if (status === 'running') {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--interactive-primary)]" />;
  }
  if (status === 'error') {
    return <AlertCircle className="h-3 w-3 shrink-0 text-[var(--interactive-danger)]" />;
  }
  return <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-[var(--color-verdict-pass)]" />;
}

function ConsultationRow({ consultation, status }: { consultation: Consultation; status: Status }) {
  const { specialist, brief, retries } = consultation;
  const running = status === 'running';
  const errored = status === 'error';
  const result = completedResult(consultation);
  const duration = formatDuration(durationMs(consultation));
  const rows = result?.row_count ?? null;
  const sql = result?.sql ?? null;
  const error = errorText(consultation);
  const question = brief?.question?.trim();

  const meta: string[] = [];
  if (!errored && typeof rows === 'number') meta.push(`${rows} ${rows === 1 ? 'row' : 'rows'}`);
  if (retries.length > 0) meta.push(`${retries.length} ${retries.length === 1 ? 'retry' : 'retries'}`);

  const expandable = !running && Boolean(question || sql || error || retries.length > 0);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'group relative pl-3.5',
        'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px',
        errored ? 'before:bg-[var(--interactive-danger)]' : 'before:bg-[var(--border-default)]',
        running && 'before:bg-[var(--interactive-primary)]',
      )}
      data-specialist={specialist}
      data-status={status}
    >
      <button
        type="button"
        disabled={!expandable}
        onClick={() => expandable && setExpanded((v) => !v)}
        className={cn('block w-full py-1.5 text-left', expandable && 'cursor-pointer')}
      >
        <span className="flex items-baseline gap-2 text-[12px]">
          <StatusGlyph status={status} />
          <span
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.08em]',
              errored ? 'text-[var(--interactive-danger)]' : 'text-[var(--text-secondary)]',
            )}
          >
            {specialistLabel(specialist)}
          </span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="min-w-0 flex-1 text-[var(--text-primary)]">
            {running ? <Shimmer>consulting…</Shimmer> : errored ? 'consultation failed' : 'consulted'}
          </span>
          {duration && !running ? (
            <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-muted)]">{duration}</span>
          ) : null}
          {expandable ? (
            <ChevronRight className={cn('h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform', expanded && 'rotate-90')} />
          ) : null}
        </span>

        {running && question ? (
          <span className="mt-0.5 block pl-[18px] text-[11px] italic text-[var(--text-muted)] line-clamp-2">
            {question}
          </span>
        ) : null}

        {!running && meta.length > 0 ? (
          <span className="mt-0.5 block pl-[18px] font-mono text-[10.5px] text-[var(--text-muted)]">
            {meta.map((seg, i) => (
              <span key={i}>
                {i > 0 ? <span className="mx-1.5 text-[var(--border-default)]">·</span> : null}
                <span>{seg}</span>
              </span>
            ))}
          </span>
        ) : null}
      </button>

      {expanded && expandable ? (
        <div className="mb-1 ml-[18px] mt-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2.5">
          {question ? (
            <div className="mb-2 text-[11px] leading-relaxed text-[var(--text-primary)]">{question}</div>
          ) : null}

          {sql ? (
            <pre className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-code-block)] p-2 font-mono text-[10.5px] text-[var(--text-primary)]">
              {sql}
            </pre>
          ) : null}

          {error ? (
            <pre className="mb-2 whitespace-pre-wrap break-words rounded bg-[color-mix(in_srgb,var(--interactive-danger)_8%,var(--bg-primary))] p-2 font-mono text-[10.5px] text-[var(--interactive-danger)]">
              {error}
            </pre>
          ) : null}

          {retries.map((retry) => {
            const diag = retry.failed_attempt.verdict.diagnostic;
            const retrySql = retry.failed_attempt.sql?.trim();
            const capped = retry.attempt_number > MAX_SPECIALIST_ATTEMPTS;
            return (
              <div
                key={retry.id}
                className="mb-2 rounded border border-[color-mix(in_srgb,var(--interactive-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_5%,var(--bg-primary))] p-2 last:mb-0"
              >
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--interactive-danger)]">
                  {capped
                    ? `gave up after ${MAX_SPECIALIST_ATTEMPTS} attempts`
                    : `attempt ${retry.attempt_number} of ${MAX_SPECIALIST_ATTEMPTS}`}
                  {diag ? ` · ${diag.rule_id}` : ''}
                </div>
                {diag?.message ? (
                  <div className="text-[11px] text-[var(--text-primary)]">{diag.message}</div>
                ) : null}
                {diag?.hint ? (
                  <div className="mt-1 text-[10.5px] italic text-[var(--text-secondary)]">{diag.hint}</div>
                ) : null}
                {retrySql ? (
                  <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-code-block)] p-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                    {retrySql}
                  </pre>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SpecialistGroup({ parts, settled }: { parts: SpecialistPart[]; settled: boolean }) {
  const consultations = buildConsultations(parts);
  const statuses = consultations.map((c) => consultationStatus(c, settled));
  const anyRunning = statuses.some((s) => s === 'running');
  const anyError = statuses.some((s) => s === 'error');

  // Stay expanded for the whole live turn so the block doesn't flicker as rows
  // resolve; collapse to a one-line summary once the turn settles. A manual
  // toggle pins the state.
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? settled;

  if (consultations.length === 0) return null;

  const distinct = Array.from(new Set(consultations.map((c) => c.specialist)));
  const totalRows = consultations.reduce((sum, c) => sum + (completedResult(c)?.row_count ?? 0), 0);
  const totalMs = consultations.reduce((sum, c) => sum + (durationMs(c) ?? 0), 0);

  const verb = anyRunning ? 'Consulting' : 'Consulted';
  const headLabel =
    distinct.length === 1
      ? `${verb} the ${specialistLabel(distinct[0])}${anyRunning ? '…' : ''}`
      : `${verb} ${distinct.length} specialists${anyRunning ? '…' : ''}`;

  const summaryMeta: string[] = [];
  if (!anyRunning && totalRows > 0) summaryMeta.push(`${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`);
  const totalDuration = formatDuration(totalMs > 0 ? totalMs : null);
  if (!anyRunning && totalDuration) summaryMeta.push(totalDuration);

  return (
    <div className="flex flex-col gap-1" data-part-type="specialist-group">
      <button
        type="button"
        onClick={() => setOverride(!collapsed)}
        aria-expanded={!collapsed}
        className="inline-flex w-fit items-center gap-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', !collapsed && 'rotate-90')} />
        {anyRunning ? (
          <Shimmer className="font-mono uppercase tracking-[0.08em]">{headLabel}</Shimmer>
        ) : (
          <span
            className={cn(
              'font-mono uppercase tracking-[0.08em]',
              anyError && 'text-[var(--interactive-danger)]',
            )}
          >
            {headLabel}
          </span>
        )}
        {summaryMeta.length > 0 ? (
          <span className="font-mono lowercase tracking-normal text-[var(--text-muted)]">
            · {summaryMeta.join(' · ')}
          </span>
        ) : null}
      </button>

      {!collapsed ? (
        <div className="flex flex-col gap-1.5">
          {consultations.map((c, i) => (
            <ConsultationRow key={c.key} consultation={c} status={statuses[i]} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
