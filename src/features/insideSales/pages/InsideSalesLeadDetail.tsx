import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Cpu,
  FileText,
  HeartPulse,
  IndianRupee,
  Info,
  ListChecks,
  Mic,
  Package,
  Receipt,
  User,
  Users,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  LoadingState,
  MetricChip,
  PageSurface,
  RecordNavigator,
  RecordWorkspace,
  SectionBlock,
  Tooltip,
  type RecordWorkspaceTab,
} from '@/components/ui';
import { PAGE_METADATA } from '@/config/pageMetadata';
import { useAppConfig } from '@/hooks';
import { AudioPlayer } from '@/features/transcript/components/AudioPlayer';
import { CallResultPanel } from '../components/CallResultPanel';
import { NewInsideSalesEvalOverlay } from '../components/NewInsideSalesEvalOverlay';
import { MqlScoreBadge } from '../components/MqlScoreBadge';
import { LeadCallTimeline } from '../components/LeadCallTimeline';
import { fetchLeadDetail } from '@/services/api/insideSales';
import { useLeadsStore } from '@/stores/insideSalesStore';
import type {
  LeadCallRecord,
  LeadDetailFullResponse,
  LeadEvalHistoryEntry,
} from '@/services/api/insideSales';
import type { AppDrilldownFieldConfig, AppDrilldownSectionConfig, ThreadEvalRow } from '@/types';
import { cn } from '@/utils';
import { formatFrt } from '@/utils/formatters';
import { routes } from '@/config/routes';
import { StageBadge } from '../components/StageBadge';

/* ── Formatting helpers ───────────────────────────────────────── */

function fmtAdherence(seconds: number | null): string {
  if (seconds === null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m after preferred`;
  return `${m}m after preferred`;
}

function fmtDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function cleanEnum(val: string | null | undefined): string {
  if (!val) return '—';
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || '—';
}

/* ── Small building blocks ─────────────────────────────────────── */

/** Renders `null` when the value is an em-dash, empty, or literally falsy —
 *  so drilldown grids aren't padded with "—" noise for pre-converted leads.
 *  Opt out with `alwaysShow` for cases where a missing value is the signal
 *  (e.g. "Owner: —" where absence is worth calling out). */
function Field({
  label,
  value,
  mono,
  alwaysShow = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  alwaysShow?: boolean;
}) {
  const empty = !value || value === '—';
  if (empty && !alwaysShow) return null;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {label}
      </span>
      <span
        className={cn(
          'text-[13px] text-[var(--text-primary)] truncate',
          mono && 'font-mono',
          empty && 'text-[var(--text-muted)]',
        )}
        title={value && value !== '—' ? value : undefined}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatLeadFieldValue(lead: LeadDetailFullResponse, field: AppDrilldownFieldConfig): string {
  switch (field.key) {
    case 'phone':
      return lead.phone;
    case 'email':
      return lead.email ?? '—';
    case 'city':
      return lead.city ?? '—';
    case 'ageGroup':
      return lead.ageGroup ?? '—';
    case 'source':
      return [lead.source, lead.sourceCampaign].filter(Boolean).join(' · ') || '—';
    case 'agentName':
      return lead.agentName ?? '—';
    case 'createdOn':
      return fmtDateTime(lead.createdOn);
    case 'condition':
      return cleanEnum(lead.condition);
    case 'hba1cBand':
      return cleanEnum(lead.hba1cBand);
    case 'bloodSugarBand':
      return cleanEnum(lead.bloodSugarBand);
    case 'diabetesDuration':
      return cleanEnum(lead.diabetesDuration);
    case 'currentManagement':
      return cleanEnum(lead.currentManagement);
    case 'goal':
      return cleanEnum(lead.goal);
    case 'intentToPay':
      return cleanEnum(lead.intentToPay);
    case 'preferredCallTime':
      return lead.preferredCallTime ? fmtDateTime(lead.preferredCallTime) : '—';
    default: {
      const value = lead[field.key as keyof LeadDetailFullResponse];
      return typeof value === 'string' && value.trim() ? value : '—';
    }
  }
}

/* ── Plan purchase surface ─────────────────────────────────────── */

/** Short date (e.g. "23 Apr, 06:36"). Plan receipts don't need the year —
 *  the lead conversion date supplies that anchor. */
function fmtShortDateTime(value: string | null): string | null {
  if (!value) return null;
  try {
    const d = new Date(value.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return value;
  }
}

function fmtShortDate(value: string | null): string | null {
  if (!value) return null;
  try {
    const d = new Date(value.includes('T') ? value : `${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short' });
  } catch {
    return value;
  }
}

function Chip({ icon: Icon, label, tone = 'neutral' }: {
  icon: typeof BadgeCheck;
  label: string;
  tone?: 'neutral' | 'success' | 'info' | 'brand';
}) {
  const toneClass = {
    neutral: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
    success: 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)] border-[color-mix(in_srgb,var(--color-success)_35%,transparent)]',
    info: 'bg-[color-mix(in_srgb,var(--color-info)_15%,transparent)] text-[var(--color-info)] border-[color-mix(in_srgb,var(--color-info)_35%,transparent)]',
    brand: 'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)] border-[var(--border-brand)]/60',
  }[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        toneClass,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function TimelineRow({ icon: Icon, label, value }: {
  icon: typeof BadgeCheck;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-center gap-3 text-xs">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]">
        <Icon className="h-3 w-3" />
      </span>
      <span className="text-[var(--text-muted)] w-[140px]">{label}</span>
      <span className="tabular-nums text-[var(--text-primary)]">{value}</span>
    </li>
  );
}

/**
 * Plan Purchased — scannable receipt-style card. Shown only when there is an
 * actual purchase signal (plan name or payment id). `leadConversionDate` alone
 * doesn't trigger the card because LSQ populates it for every lead regardless
 * of purchase outcome.
 *
 * Sections cascade in the order a sales-ops reader actually scans a sale:
 *   1. Plan name + top-line chips (price · duration · CGM flag)
 *   2. Timeline of the sale (conversion → assigned → program window)
 *   3. Payment block (id + date + invoice)
 *   4. Device block (only when device data is present)
 *   5. Sales team footer (only when present)
 */
function PlanPurchasedCard({ plan }: { plan: LeadDetailFullResponse['plan'] }) {
  const hasPurchase = isNonEmpty(plan.planName) || isNonEmpty(plan.paymentId);
  if (!hasPurchase) return null;

  const conversionAt = fmtShortDateTime(plan.leadConversionDate);
  const assignedAt = fmtShortDateTime(plan.planAssignedAt);
  const signUpAt = fmtShortDate(plan.signUpDate);
  const programStart = fmtShortDate(plan.programStartDate);
  const programEnd = fmtShortDate(plan.programEndDate);
  const paymentAt = fmtShortDateTime(plan.paymentDateAndTime);

  const hasPayment = isNonEmpty(plan.paymentId) || isNonEmpty(plan.invoiceAmount);
  const hasDevice = [plan.cgm, plan.cgmBrand, plan.sensorCount, plan.transmitterCount, plan.bcaDevice, plan.deviceAwbNumber]
    .some((v) => isNonEmpty(v));
  const cgmDetail = [plan.cgmBrand, plan.cgm]
    .filter(isNonEmpty)
    .join(' · ');
  const deviceCounts = [
    isNonEmpty(plan.sensorCount) && `${plan.sensorCount}S`,
    isNonEmpty(plan.transmitterCount) && `${plan.transmitterCount}T`,
  ].filter(Boolean).join(' · ');

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-xl border',
        'border-[color-mix(in_srgb,var(--color-success)_22%,transparent)]',
        'bg-[var(--bg-elevated)]',
      )}
    >
      {/* Thin success accent strip along the left edge — marks the card as
          the "win" section without flooding the surface with tint. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-[var(--color-success)] opacity-80"
      />
      <div className="flex flex-col gap-5 p-5 pl-6">
        {/* Header — win badge + eyebrow */}
        <header className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)] ring-1 ring-[color-mix(in_srgb,var(--color-success)_35%,transparent)]">
            <BadgeCheck className="h-3.5 w-3.5" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-success)]">
            Plan Purchased
          </p>
        </header>

        {/* Plan name + rhythm chips */}
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold leading-tight text-[var(--text-primary)]">
            {plan.planName ?? 'Plan details not named'}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {isNonEmpty(plan.programPrice) && (
              <Chip icon={IndianRupee} label={`₹${plan.programPrice}`} tone="success" />
            )}
            {isNonEmpty(plan.durationOrQuantity) && (
              <Chip icon={CalendarClock} label={plan.durationOrQuantity} tone="neutral" />
            )}
            {isNonEmpty(plan.planIncludesCgm) && (
              <Chip icon={Cpu} label={`CGM: ${plan.planIncludesCgm}`} tone="info" />
            )}
          </div>
        </div>

        {/* Two-up: timeline on the left, payment on the right */}
        <div className="grid gap-5 lg:grid-cols-2">
          {(conversionAt || assignedAt || signUpAt || programStart || programEnd) && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Timeline
              </p>
              <ul className="flex flex-col gap-2">
                {conversionAt && (
                  <TimelineRow icon={CheckCircle2} label="Converted" value={conversionAt} />
                )}
                {assignedAt && (
                  <TimelineRow icon={BadgeCheck} label="Plan Assigned" value={assignedAt} />
                )}
                {signUpAt && (
                  <TimelineRow icon={User} label="Sign Up" value={signUpAt} />
                )}
                {(programStart || programEnd) && (
                  <TimelineRow
                    icon={CalendarClock}
                    label="Program Window"
                    value={[programStart, programEnd].filter(Boolean).join(' → ')}
                  />
                )}
              </ul>
            </div>
          )}

          {hasPayment && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Payment
              </p>
              <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                {isNonEmpty(plan.paymentId) && (
                  <div className="flex items-center gap-2 text-xs">
                    <Receipt className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                    <span className="font-mono truncate text-[var(--text-primary)]" title={plan.paymentId}>
                      {plan.paymentId}
                    </span>
                  </div>
                )}
                {paymentAt && (
                  <div className="flex items-center gap-2 text-xs">
                    <CalendarClock className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                    <span className="tabular-nums text-[var(--text-secondary)]">{paymentAt}</span>
                  </div>
                )}
                {isNonEmpty(plan.invoiceAmount) && (
                  <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Invoice</span>
                    <span className="tabular-nums text-[13px] font-semibold text-[var(--text-primary)]">
                      ₹{plan.invoiceAmount}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Device + sales footer — low visual weight, only rendered when data exists */}
        {(hasDevice || isNonEmpty(plan.salesTeam) || isNonEmpty(plan.nutraceuticalsSold)) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">
            {hasDevice && (
              <span className="inline-flex items-center gap-1.5">
                <Package className="h-3 w-3" />
                {[cgmDetail, deviceCounts, plan.bcaDevice && `BCA ${plan.bcaDevice}`].filter(Boolean).join(' · ')}
              </span>
            )}
            {isNonEmpty(plan.nutraceuticalsSold) && (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" />
                {plan.nutraceuticalsSold}
              </span>
            )}
            {isNonEmpty(plan.salesTeam) && (
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                {plan.salesTeam}
              </span>
            )}
            {isNonEmpty(plan.deviceAwbNumber) && (
              <span className="inline-flex items-center gap-1.5">
                AWB:&nbsp;<span className="font-mono text-[var(--text-secondary)]">{plan.deviceAwbNumber}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// Map drilldown section id to a tone + icon so every section gets a tasteful
// visual anchor without hardcoding UI concerns into the app-config data.
const SECTION_ICONS: Record<string, { icon: typeof BadgeCheck; tone: 'brand' | 'info' | 'neutral' }> = {
  'contact-source': { icon: User, tone: 'brand' },
  'health-profile': { icon: HeartPulse, tone: 'info' },
};

/** A drilldown field is considered empty when ``formatLeadFieldValue`` returns
 *  an unset/em-dash value. This is the same contract ``Field`` uses to hide
 *  individual rows; we lift it up to the section level so that a section
 *  whose every field is empty (e.g. Health Profile before any care-plan data
 *  has been collected) disappears entirely — matching how PlanPurchasedCard
 *  already handles the "no purchase yet" case. */
function isDrilldownValueEmpty(value: string): boolean {
  return !value || value === '—';
}

function DrilldownSection({
  lead,
  section,
}: {
  lead: LeadDetailFullResponse;
  section: AppDrilldownSectionConfig;
}) {
  const meta = SECTION_ICONS[section.id] ?? { icon: ListChecks, tone: 'neutral' as const };
  // Pre-compute values once so the emptiness check and the render pass agree
  // on the same data (no drift between "would Field hide this?" and "did we
  // count it as empty at the section level?").
  const populated = section.fields
    .map((field) => ({ field, value: formatLeadFieldValue(lead, field) }))
    .filter(({ value }) => !isDrilldownValueEmpty(value));
  if (populated.length === 0) return null;
  return (
    <SectionBlock title={section.title} icon={meta.icon} tone={meta.tone}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {populated.map(({ field, value }) => (
          <Field
            key={field.key}
            label={field.label}
            value={value}
            mono={field.presentation === 'mono'}
          />
        ))}
      </div>
    </SectionBlock>
  );
}

/* ── Summary rail — left column of the workspace ────────────────── */

/**
 * Tonal rules for the summary rail metrics. Kept adjacent to the rail
 * component so the mapping stays explicit and easy to reason about:
 *
 *   Connect rate  → success when > 60%, warning when < 30%, neutral between
 *   Counseling    → success when > 0
 *   FRT           → follows `formatFrt` colour class (RAG green/amber/red)
 */
function connectRateTone(rate: number | null): 'success' | 'warning' | 'neutral' {
  if (rate === null) return 'neutral';
  if (rate >= 60) return 'success';
  if (rate < 30) return 'warning';
  return 'neutral';
}

function SummaryRail({
  lead,
  frt,
  tileFive,
}: {
  lead: LeadDetailFullResponse;
  frt: { text: string; color?: string };
  tileFive: { label: string; value: string };
}) {
  const sourceLine = [lead.source, lead.sourceCampaign].filter(Boolean).join(' · ') || '—';
  const connectTone = connectRateTone(lead.connectRate);
  return (
    <div className="flex flex-col gap-6">
      <SectionBlock title="Contact" icon={User} tone="brand">
        <div className="flex flex-col gap-3">
          <Field label="Phone" value={lead.phone || '—'} mono />
          <Field label="Owner" value={lead.agentName ?? '—'} />
          <Field label="Source" value={sourceLine} />
          <Field label="Prospect ID" value={lead.prospectId} mono />
          <Field label="Lead Created" value={fmtDateTime(lead.createdOn)} />
        </div>
      </SectionBlock>

      <SectionBlock title="Metrics" icon={Activity} tone="info">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <MetricChip label="FRT" value={frt.text} sub="SLA: 1h" valueClass={frt.color} />
          <MetricChip label="Total Dials" value={lead.totalDials || '—'} />
          <MetricChip
            label="Connect Rate"
            value={lead.connectRate !== null ? `${Math.round(lead.connectRate)}%` : '—'}
            tone={connectTone}
          />
          <MetricChip
            label="Counseling"
            value={lead.historyTruncated ? '?' : lead.counselingCount}
            sub={lead.historyTruncated ? 'history incomplete' : 'calls ≥ 10 min'}
            tone={lead.counselingCount > 0 ? 'success' : 'neutral'}
          />
          <MetricChip label={tileFive.label} value={tileFive.value} />
        </div>
      </SectionBlock>
    </div>
  );
}

/* ── Evaluations tab — audio above scorecard, pagination unchanged ─ */

function EvaluationsPanel({
  evalHistory,
  evalIdx,
  setEvalIdx,
  callHistory,
}: {
  evalHistory: LeadEvalHistoryEntry[];
  evalIdx: number;
  setEvalIdx: (updater: (prev: number) => number) => void;
  callHistory: LeadCallRecord[];
}) {
  const currentEval = evalHistory[evalIdx] ?? null;
  const currentCall = useMemo(
    () => (currentEval ? callHistory.find((c) => c.activityId === currentEval.threadId) : null),
    [currentEval, callHistory],
  );

  if (!currentEval) {
    return (
      <EmptyState
        icon={FileText}
        title="Not yet evaluated"
        description="Select a call from the timeline and click Evaluate."
        fill
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {evalHistory.length > 1 && (
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          <button
            onClick={() => setEvalIdx((index) => Math.min(index + 1, evalHistory.length - 1))}
            disabled={evalIdx >= evalHistory.length - 1}
            className="rounded p-1 hover:bg-[var(--interactive-secondary)] disabled:opacity-40"
            aria-label="Older evaluation"
          >
            ‹
          </button>
          <span>
            Evaluation {evalHistory.length - evalIdx} of {evalHistory.length}
          </span>
          <button
            onClick={() => setEvalIdx((index) => Math.max(index - 1, 0))}
            disabled={evalIdx <= 0}
            className="rounded p-1 hover:bg-[var(--interactive-secondary)] disabled:opacity-40"
            aria-label="Newer evaluation"
          >
            ›
          </button>
        </div>
      )}

      {currentCall?.recordingUrl && (
        <SectionBlock title="Call Recording" icon={Mic} tone="brand">
          <AudioPlayer audioUrl={currentCall.recordingUrl} appId="inside-sales" />
        </SectionBlock>
      )}

      <CallResultPanel thread={currentEval as unknown as ThreadEvalRow} appId="inside-sales" />
    </div>
  );
}

/* ── Page component ────────────────────────────────────────────── */

export function InsideSalesLeadDetail() {
  const appConfig = useAppConfig('inside-sales');
  const drilldownSections = appConfig.collections.drilldowns.lead?.sections ?? [];
  const { prospectId } = useParams<{ prospectId: string }>();
  const navigate = useNavigate();
  // Navigation list: the ordered leads loaded on the listing page. Opening
  // a lead detail directly (no prior listing visit) results in an empty
  // list — prev/next then simply render disabled.
  const leadsList = useLeadsStore((s) => s.leads);

  const listNav = useMemo(() => {
    if (!prospectId) return null;
    const idx = leadsList.findIndex((l) => l.prospectId === prospectId);
    if (idx < 0) return null;
    return {
      index: idx,
      total: leadsList.length,
      prev: idx > 0 ? leadsList[idx - 1].prospectId : null,
      next: idx < leadsList.length - 1 ? leadsList[idx + 1].prospectId : null,
    };
  }, [leadsList, prospectId]);

  const goPrev = listNav?.prev
    ? () => navigate(routes.insideSales.leadDetail(listNav.prev as string))
    : undefined;
  const goNext = listNav?.next
    ? () => navigate(routes.insideSales.leadDetail(listNav.next as string))
    : undefined;

  const [lead, setLead] = useState<LeadDetailFullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evalIdx, setEvalIdx] = useState(0);
  const [evalOpen, setEvalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!prospectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeadDetail(prospectId);
      setLead(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [prospectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setEvalIdx(0); }, [prospectId]);

  if (loading) {
    return (
      <PageSurface
        icon={PAGE_METADATA.leadDetail.icon}
        title="Lead"
        back={{ to: routes.insideSales.listing, label: 'Leads' }}
        showHeader={false}
      >
        <LoadingState />
      </PageSurface>
    );
  }

  if (error || !lead) {
    return (
      <PageSurface
        icon={PAGE_METADATA.leadDetail.icon}
        title="Lead"
        back={{ to: routes.insideSales.listing, label: 'Leads' }}
      >
        <EmptyState
          icon={AlertTriangle}
          title="Failed to load lead"
          description={error ?? 'Lead not found.'}
          action={{ label: 'Retry', onClick: load }}
          fill
        />
      </PageSurface>
    );
  }

  const displayName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.phone;
  const secondaryInfo = [lead.phone, lead.city, lead.condition].filter(Boolean).join(' · ');

  const frt = formatFrt(lead.frtSeconds);
  const tileFive = lead.preferredCallTime
    ? { label: 'Callback Adherence', value: fmtAdherence(lead.callbackAdherenceSeconds) }
    : { label: 'Lead Age', value: `${lead.leadAgeDays}d` };

  const evaluatableCalls = lead.callHistory.filter((call) => call.recordingUrl && call.evalScore === null);
  const canEvaluate = evaluatableCalls.length > 0;

  const activeEvalActivityId = lead.evalHistory[evalIdx]?.threadId ?? null;

  const overviewTab = (
    <div className="flex min-h-0 flex-1 flex-col gap-8">
      <PlanPurchasedCard plan={lead.plan} />
      {/* Skip sections the sticky rail already owns (identity/contact/source).
          Those fields are rendered once on the left and never duplicated. */}
      {drilldownSections
        .filter((section) => section.id !== 'contact-source')
        .map((section) => (
          <DrilldownSection key={section.id} lead={lead} section={section} />
        ))}
    </div>
  );

  const timelineTab = (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {lead.historyTruncated && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
          Showing the first 200 calls — call history may be incomplete. Metrics marked with a warning may be inaccurate.
        </div>
      )}
      <LeadCallTimeline callHistory={lead.callHistory} activeEvalActivityId={activeEvalActivityId} />
    </div>
  );

  const evaluationsTab = (
    <EvaluationsPanel
      evalHistory={lead.evalHistory}
      evalIdx={evalIdx}
      setEvalIdx={setEvalIdx}
      callHistory={lead.callHistory}
    />
  );

  const tabs: RecordWorkspaceTab[] = [
    { id: 'overview', label: 'Overview', content: overviewTab },
    {
      id: 'timeline',
      label: 'Call Timeline',
      badge: lead.callHistory.length > 0 ? String(lead.callHistory.length) : undefined,
      content: timelineTab,
    },
    {
      id: 'evaluations',
      label: 'Evaluations',
      badge: lead.evalHistory.length > 0 ? String(lead.evalHistory.length) : undefined,
      content: evaluationsTab,
    },
  ];

  const metaTooltip = secondaryInfo ? (
    <div className="text-xs text-[var(--text-secondary)]">{secondaryInfo}</div>
  ) : null;

  const subtitle = (
    <>
      <StageBadge stage={lead.prospectStage} truncate={false} />
      <MqlScoreBadge score={lead.mqlScore} signals={lead.mqlSignals} />
      {metaTooltip && (
        <Tooltip content={metaTooltip} closeDelay={150}>
          <Info className="h-3.5 w-3.5 text-[var(--text-muted)] cursor-help" />
        </Tooltip>
      )}
    </>
  );

  const actions = (
    <>
      {listNav && (
        <RecordNavigator
          recordLabel="lead"
          current={listNav.index + 1}
          total={listNav.total}
          onPrev={goPrev}
          onNext={goNext}
          disableShortcuts={evalOpen}
        />
      )}
      <span title={canEvaluate ? undefined : 'No unevaluated recordings'}>
        <Button size="sm" disabled={!canEvaluate} onClick={() => setEvalOpen(true)}>
          Evaluate
        </Button>
      </span>
    </>
  );

  return (
    <PageSurface
      icon={PAGE_METADATA.leadDetail.icon}
      title={displayName}
      subtitle={subtitle}
      back={{ to: routes.insideSales.listing, label: 'Leads' }}
      actions={actions}
    >
      <RecordWorkspace
        summary={<SummaryRail lead={lead} frt={frt} tileFive={tileFive} />}
        tabs={tabs}
        defaultTab="overview"
      />

      {evalOpen && evaluatableCalls.length > 0 && (
        <NewInsideSalesEvalOverlay
          onClose={() => { setEvalOpen(false); load(); }}
          preSelectedCallIds={evaluatableCalls.map((c) => c.activityId)}
          prefillContext={{
            kind: 'lead',
            leadName: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.phone,
          }}
        />
      )}
    </PageSurface>
  );
}
