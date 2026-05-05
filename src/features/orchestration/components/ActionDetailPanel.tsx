import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import {
  getActionProviderStatus,
  isActionProviderTerminal,
} from '@/features/orchestration/types';
import { cn } from '@/utils';
import type { ActionRow } from '@/features/orchestration/types';

interface Props {
  action: ActionRow | null;
  open: boolean;
  onClose: () => void;
}

const HEADING_ID = 'orchestration-action-detail-heading';

export function ActionDetailPanel({ action, open, onClose }: Props) {
  return (
    <RightSlideOverShell
      isOpen={open}
      onClose={onClose}
      labelledBy={HEADING_ID}
      widthClassName="w-[var(--overlay-width-md)] max-w-[90vw]"
    >
      {action ? <PanelBody action={action} onClose={onClose} /> : null}
    </RightSlideOverShell>
  );
}

function PanelBody({ action, onClose }: { action: ActionRow; onClose: () => void }) {
  const channel = (action.channel || '').toLowerCase();
  return (
    <>
      <Header action={action} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {channel === 'bolna' ? (
          <BolnaBody action={action} />
        ) : channel === 'wati' ? (
          <WatiBody action={action} />
        ) : (
          <GenericBody action={action} />
        )}
      </div>
    </>
  );
}

function Header({ action, onClose }: { action: ActionRow; onClose: () => void }) {
  return (
    <div
      className="flex items-start justify-between gap-3 border-b px-5 py-4"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
          {action.channel} · {action.actionType}
        </div>
        <h2
          id={HEADING_ID}
          className="mt-1 truncate text-base font-semibold text-[var(--text-primary)]"
        >
          Recipient {action.recipientId}
        </h2>
        <div className="mt-1 text-xs text-[var(--text-secondary)]">
          {fmtDate(action.createdAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Bolna ──────────────────────────────────────────────────────────────────

const BOLNA_TIMELINE: { key: string; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'terminal', label: 'Terminal' },
];

function BolnaBody({ action }: { action: ActionRow }) {
  const response = (action.response ?? {}) as Record<string, unknown>;
  const providerStatus = getActionProviderStatus(action);
  const providerTerminal = isActionProviderTerminal(action);
  const recordingUrl = stringField(response.recording_url);
  const transcript = stringField(response.transcript);
  const totalCost = response.total_cost;
  const costBreakdown = (response.cost_breakdown ?? {}) as Record<string, unknown>;
  const telephonyProvider = stringField(response.telephony_provider);
  const hangupReason = stringField(response.hangup_reason);
  const duration = response.duration_sec;
  const executionId = stringField(response.execution_id);
  const batchId = stringField(response.batch_id);

  const stageReached = providerTerminal
    ? 'terminal'
    : providerStatus && providerStatus !== 'queued'
      ? 'in_progress'
      : 'queued';

  return (
    <div className="space-y-5">
      <Timeline stages={BOLNA_TIMELINE} reached={stageReached} terminalLabel={providerStatus} />

      <Section title="Call">
        <KeyValueRow label="Status">
          <BolnaStatusBadge status={providerStatus} terminal={providerTerminal} />
        </KeyValueRow>
        {executionId ? (
          <KeyValueRow label="Execution">
            <span className="font-mono text-xs">{executionId}</span>
          </KeyValueRow>
        ) : null}
        {batchId ? (
          <KeyValueRow label="Batch">
            <span className="font-mono text-xs">{batchId}</span>
          </KeyValueRow>
        ) : null}
        {telephonyProvider ? (
          <KeyValueRow label="Telephony">{telephonyProvider}</KeyValueRow>
        ) : null}
        {hangupReason ? <KeyValueRow label="Hangup reason">{hangupReason}</KeyValueRow> : null}
        {duration !== undefined && duration !== null ? (
          <KeyValueRow label="Duration">{fmtDuration(duration)}</KeyValueRow>
        ) : null}
      </Section>

      {recordingUrl ? (
        <Section title="Recording">
          <audio controls preload="none" src={recordingUrl} className="w-full">
            <track kind="captions" />
          </audio>
          <a
            href={recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-[var(--text-brand)] underline"
          >
            Open in new tab
          </a>
        </Section>
      ) : null}

      {transcript ? (
        <Collapsible title="Transcript" defaultOpen={false}>
          <pre className="whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
            {transcript}
          </pre>
        </Collapsible>
      ) : null}

      <Section title="Cost">
        {totalCost !== undefined && totalCost !== null ? (
          <KeyValueRow label="Total">{fmtMoney(totalCost)}</KeyValueRow>
        ) : null}
        {Object.keys(costBreakdown).length > 0 ? (
          <div className="mt-1 space-y-1">
            {Object.entries(costBreakdown).map(([k, v]) => (
              <KeyValueRow key={k} label={k}>
                {fmtMoney(v)}
              </KeyValueRow>
            ))}
          </div>
        ) : totalCost === undefined || totalCost === null ? (
          <div className="text-xs text-[var(--text-secondary)]">No cost recorded.</div>
        ) : null}
      </Section>

      <RawJsonSection action={action} />
    </div>
  );
}

function BolnaStatusBadge({
  status,
  terminal,
}: {
  status: string | null;
  terminal: boolean;
}) {
  const variant = bolnaStatusVariant(status, terminal);
  return <Badge variant={variant}>{status ?? 'unknown'}</Badge>;
}

function bolnaStatusVariant(status: string | null, terminal: boolean): BadgeVariant {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (!terminal) return 'info';
  if (['completed', 'answered', 'success'].includes(s)) return 'success';
  if (['no-answer', 'rnr', 'busy', 'cancelled', 'canceled', 'stopped'].includes(s)) {
    return 'warning';
  }
  return 'error';
}

// ─── WATI ───────────────────────────────────────────────────────────────────

const WATI_TIMELINE: { key: string; label: string }[] = [
  { key: 'sent', label: 'Sent' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'read', label: 'Read' },
  { key: 'replied', label: 'Replied' },
];

function WatiBody({ action }: { action: ActionRow }) {
  const response = (action.response ?? {}) as Record<string, unknown>;
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const localMessageId = stringField(response.localMessageId) ?? stringField(payload.localMessageId);
  const templateName = stringField(payload.template_name) ?? stringField(payload.templateName);
  const broadcastName = stringField(payload.broadcast_name) ?? stringField(payload.broadcastName);
  const channelNumber = stringField(payload.channel_number) ?? stringField(payload.channelNumber);
  const variablesRaw = (payload.template_payload ?? payload.parameters ?? null) as
    | unknown
    | null;
  const variables = collectWatiVariables(variablesRaw);

  const reached = inferWatiStage(action);

  return (
    <div className="space-y-5">
      <Timeline stages={WATI_TIMELINE} reached={reached} terminalLabel={action.actionType} />

      <Section title="Template">
        {templateName ? <KeyValueRow label="Name">{templateName}</KeyValueRow> : null}
        {broadcastName ? <KeyValueRow label="Broadcast">{broadcastName}</KeyValueRow> : null}
        {channelNumber ? (
          <KeyValueRow label="Channel">
            <span className="font-mono text-xs">{channelNumber}</span>
          </KeyValueRow>
        ) : null}
        {localMessageId ? (
          <KeyValueRow label="Local message">
            <span className="font-mono text-xs">{localMessageId}</span>
          </KeyValueRow>
        ) : null}
      </Section>

      {variables.length > 0 ? (
        <Section title="Variables">
          <table className="w-full text-xs">
            <thead className="text-left text-[var(--text-secondary)]">
              <tr>
                <th className="py-1 pr-3 font-medium">Key</th>
                <th className="py-1 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {variables.map((row, i) => (
                <tr key={`${row.key}-${i}`} className="border-t border-[var(--border-subtle)]">
                  <td className="py-1 pr-3 font-mono text-[var(--text-primary)]">{row.key}</td>
                  <td className="py-1 font-mono text-[var(--text-secondary)]">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <RawJsonSection action={action} />
    </div>
  );
}

function inferWatiStage(action: ActionRow): string {
  const t = (action.actionType || '').toLowerCase();
  if (t.includes('replied')) return 'replied';
  if (t.includes('read')) return 'read';
  if (t.includes('delivered')) return 'delivered';
  if (t.includes('failed')) return 'sent';
  return 'sent';
}

function collectWatiVariables(input: unknown): { key: string; value: string }[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((item, i) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const key = stringField(o.name) ?? stringField(o.key) ?? String(i + 1);
          const value = stringField(o.value) ?? JSON.stringify(o);
          return { key, value };
        }
        return { key: String(i + 1), value: String(item) };
      })
      .filter((row) => row.value !== undefined);
  }
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: typeof v === 'string' ? v : JSON.stringify(v),
    }));
  }
  return [];
}

// ─── Generic fallback ───────────────────────────────────────────────────────

function GenericBody({ action }: { action: ActionRow }) {
  return (
    <div className="space-y-5">
      <Section title="Action">
        <KeyValueRow label="Channel">{action.channel}</KeyValueRow>
        <KeyValueRow label="Type">{action.actionType}</KeyValueRow>
        <KeyValueRow label="Status">{action.status}</KeyValueRow>
        {action.error ? (
          <KeyValueRow label="Error">
            <span className="text-[var(--color-error)]">{action.error}</span>
          </KeyValueRow>
        ) : null}
      </Section>
      <RawJsonSection action={action} />
    </div>
  );
}

// ─── Shared building blocks ─────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function KeyValueRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="text-right text-[var(--text-primary)]">{children}</span>
    </div>
  );
}

function Timeline({
  stages,
  reached,
  terminalLabel,
}: {
  stages: { key: string; label: string }[];
  reached: string;
  terminalLabel: string | null;
}) {
  const reachedIndex = Math.max(
    stages.findIndex((s) => s.key === reached),
    0,
  );
  return (
    <ol className="flex items-center gap-2 text-xs">
      {stages.map((stage, i) => {
        const isReached = i <= reachedIndex;
        const isCurrent = i === reachedIndex;
        return (
          <li key={stage.key} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                isReached
                  ? 'bg-[var(--color-success)]'
                  : 'bg-[var(--bg-tertiary)] ring-1 ring-[var(--border-subtle)]',
              )}
            />
            <span
              className={cn(
                isCurrent
                  ? 'font-medium text-[var(--text-primary)]'
                  : isReached
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]',
              )}
            >
              {isCurrent && terminalLabel ? terminalLabel : stage.label}
            </span>
            {i < stages.length - 1 ? (
              <span className="h-px w-4 bg-[var(--border-subtle)]" />
            ) : null}
          </li>
        );
      })}
    </ol>
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

function RawJsonSection({ action }: { action: ActionRow }) {
  const json = useMemo(() => {
    try {
      return JSON.stringify(
        {
          payload: action.payload,
          response: action.response,
        },
        null,
        2,
      );
    } catch {
      return '/* unserializable */';
    }
  }, [action]);
  return (
    <Collapsible title="Raw JSON" defaultOpen={false}>
      <pre className="max-h-[320px] overflow-auto rounded bg-[var(--bg-secondary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
        {json}
      </pre>
    </Collapsible>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stringField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function fmtDuration(seconds: unknown): string {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n)) return String(seconds);
  if (n < 60) return `${n.toFixed(1)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n - m * 60);
  return `${m}m ${s}s`;
}

function fmtMoney(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    return value.toFixed(4);
  }
  if (typeof value === 'string' && value.length > 0) return value;
  return JSON.stringify(value);
}
