import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  FileCode2,
  Headphones,
  type LucideIcon,
  Phone,
  Waves,
  X,
} from 'lucide-react';

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
const USD_CURRENCY_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export function ActionDetailPanel({ action, open, onClose }: Props) {
  return (
    <RightSlideOverShell
      isOpen={open}
      onClose={onClose}
      labelledBy={HEADING_ID}
      widthClassName="w-[var(--overlay-width-lg)] max-w-[92vw]"
    >
      {action ? <PanelBody action={action} onClose={onClose} /> : null}
    </RightSlideOverShell>
  );
}

function PanelBody({ action, onClose }: { action: ActionRow; onClose: () => void }) {
  return (
    <>
      <Header action={action} onClose={onClose} />
      <ActionDetailContent action={action} />
    </>
  );
}

/** Channel-aware action body — same content rendered by the slide-over
 *  (`ActionDetailPanel`) and the standalone sub-route page
 *  (`LogsWorkflowActionPage`). Lives outside `PanelBody` so the sub-route
 *  page can compose it inside a `PageSurface` chrome with its own back
 *  button instead of the slide-over's close X. */
export function ActionDetailContent({ action }: { action: ActionRow }) {
  const channel = (action.channel || '').toLowerCase();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {channel === 'bolna' ? (
        <BolnaBody action={action} />
      ) : channel === 'wati' ? (
        <WatiBody action={action} />
      ) : (
        <GenericBody action={action} />
      )}
    </div>
  );
}

function Header({ action, onClose }: { action: ActionRow; onClose: () => void }) {
  const providerStatus = getActionProviderStatus(action);
  const providerTerminal = isActionProviderTerminal(action);
  const channelLabel = action.channel.toUpperCase();
  const actionLabel = humanizeToken(action.actionType);
  const statusLabel = providerStatus ?? action.status;
  const statusVariant =
    (action.channel || '').toLowerCase() === 'bolna'
      ? bolnaStatusVariant(providerStatus, providerTerminal)
      : action.status === 'failed'
        ? 'error'
        : action.status === 'success'
          ? 'success'
          : 'info';

  return (
    <div
      className="flex items-start justify-between gap-3 border-b px-5 py-5"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          <span>{channelLabel}</span>
          <span className="text-[var(--text-muted)]">·</span>
          <span>{actionLabel}</span>
        </div>
        <h2
          id={HEADING_ID}
          className="mt-2 truncate text-lg font-semibold text-[var(--text-primary)]"
        >
          {action.recipientId}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Badge variant={statusVariant}>{statusLabel}</Badge>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {fmtDate(action.createdAt)}
          </span>
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
  const costSummary = summarizeCostBreakdown(costBreakdown);
  const costDetails = detailCostBreakdown(costBreakdown);

  const stageReached = providerTerminal
    ? 'terminal'
    : providerStatus && providerStatus !== 'queued'
      ? 'in_progress'
      : 'queued';

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-[var(--bg-tertiary)] p-2 text-[var(--text-secondary)]">
            <Phone className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <SectionEyebrow>Call progress</SectionEyebrow>
              <Timeline stages={BOLNA_TIMELINE} reached={stageReached} terminalLabel={providerStatus} />
            </div>
            <MetricGrid>
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
            </MetricGrid>
          </div>
        </div>
      </SectionCard>

      {recordingUrl ? (
        <SectionCard>
          <SectionHeading
            icon={Headphones}
            title="Recording"
            description="Open the call recording inline or in a new tab."
          />
          <audio controls preload="none" src={recordingUrl} className="mt-3 w-full">
            <track kind="captions" />
          </audio>
          <a
            href={recordingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--text-brand)] underline underline-offset-2"
          >
            Open in new tab
          </a>
        </SectionCard>
      ) : null}

      {transcript ? (
        <SectionCard>
          <Collapsible title="Transcript" defaultOpen={false}>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
              {transcript}
            </pre>
          </Collapsible>
        </SectionCard>
      ) : null}

      <SectionCard>
        <SectionHeading
          icon={Coins}
          title="Cost"
          description="Operational totals with structured provider breakdown. All amounts are in USD."
        />
        {totalCost !== undefined && totalCost !== null ? (
          <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Total cost
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
              {fmtMoney(totalCost)}
            </div>
          </div>
        ) : null}

        {costSummary.length > 0 ? (
          <MetricGrid className="mt-3">
            {costSummary.map((row) => (
              <KeyValueRow key={row.label} label={row.label}>
                {row.value}
              </KeyValueRow>
            ))}
          </MetricGrid>
        ) : totalCost === undefined || totalCost === null ? (
          <div className="mt-3 text-xs text-[var(--text-secondary)]">No cost recorded.</div>
        ) : null}

        {costDetails.length > 0 ? (
          <div className="mt-4 space-y-3">
            {costDetails.map((detail) => (
              <Collapsible key={detail.title} title={detail.title} defaultOpen>
                <MetricGrid>
                  {detail.rows.map((row) => (
                    <KeyValueRow key={row.label} label={row.label}>
                      {row.value}
                    </KeyValueRow>
                  ))}
                </MetricGrid>
              </Collapsible>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard>
        <RawJsonSection action={action} />
      </SectionCard>
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
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-[var(--bg-tertiary)] p-2 text-[var(--text-secondary)]">
            <Waves className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <SectionEyebrow>Delivery progress</SectionEyebrow>
              <Timeline stages={WATI_TIMELINE} reached={reached} terminalLabel={humanizeToken(action.actionType)} />
            </div>
            <MetricGrid>
              {templateName ? <KeyValueRow label="Template">{templateName}</KeyValueRow> : null}
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
            </MetricGrid>
          </div>
        </div>
      </SectionCard>

      {variables.length > 0 ? (
        <SectionCard>
          <SectionHeading
            icon={FileCode2}
            title="Template variables"
            description="Resolved variables sent with the outbound message."
          />
          <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-tertiary)] text-left text-[var(--text-secondary)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((row, i) => (
                  <tr key={`${row.key}-${i}`} className="border-t border-[var(--border-subtle)]">
                    <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{row.key}</td>
                    <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard>
        <RawJsonSection action={action} />
      </SectionCard>
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
    <div className="space-y-4">
      <SectionCard>
        <SectionHeading
          icon={FileCode2}
          title="Action summary"
          description="Normalized action metadata for channels without a specialized renderer."
        />
        <MetricGrid className="mt-3">
          <KeyValueRow label="Channel">{action.channel}</KeyValueRow>
          <KeyValueRow label="Type">{humanizeToken(action.actionType)}</KeyValueRow>
          <KeyValueRow label="Status">{action.status}</KeyValueRow>
          {action.error ? (
            <KeyValueRow label="Error">
              <span className="text-[var(--color-error)]">{action.error}</span>
            </KeyValueRow>
          ) : null}
        </MetricGrid>
      </SectionCard>
      <SectionCard>
        <RawJsonSection action={action} />
      </SectionCard>
    </div>
  );
}

// ─── Shared building blocks ─────────────────────────────────────────────────

function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-full bg-[var(--bg-tertiary)] p-2 text-[var(--text-secondary)]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <SectionEyebrow>{title}</SectionEyebrow>
        {description ? (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
      {children}
    </div>
  );
}

function MetricGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('space-y-2', className)}>{children}</div>;
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
  const payloadJson = useMemo(() => prettyJson(action.payload), [action.payload]);
  const responseJson = useMemo(() => prettyJson(action.response), [action.response]);
  return (
    <Collapsible title="Raw JSON" defaultOpen={false}>
      <div className="space-y-3">
        <JsonBlock title="Payload" body={payloadJson} />
        <JsonBlock title="Response" body={responseJson} />
      </div>
    </Collapsible>
  );
}

function JsonBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {title}
      </div>
      <pre className="max-h-[260px] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
        {body}
      </pre>
    </div>
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
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (Number.isFinite(numeric)) {
    return USD_CURRENCY_FMT.format(numeric);
  }
  if (typeof value === 'string' && value.length > 0) return value;
  return JSON.stringify(value);
}

function summarizeCostBreakdown(
  costBreakdown: Record<string, unknown>,
): Array<{ label: string; value: string }> {
  return Object.entries(costBreakdown)
    .filter(([, value]) => value == null || typeof value !== 'object')
    .map(([key, value]) => ({
      label: humanizeToken(key),
      value: fmtMoney(value),
    }));
}

function detailCostBreakdown(
  costBreakdown: Record<string, unknown>,
): Array<{ title: string; rows: Array<{ label: string; value: string }> }> {
  return Object.entries(costBreakdown)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, value]) => ({
      title: humanizeToken(key),
      rows: Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => ({
        label: humanizeToken(childKey),
        value: fmtMoney(childValue),
      })),
    }))
    .filter((detail) => detail.rows.length > 0);
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower === 'llm') return 'LLM';
      if (lower === 'sms') return 'SMS';
      if (lower === 'api') return 'API';
      if (lower === 'id') return 'ID';
      if (lower === 'url') return 'URL';
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '/* unserializable */';
  }
}
