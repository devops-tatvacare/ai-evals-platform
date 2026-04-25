import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  Info,
  User,
  Users,
  Phone as PhoneIcon,
  Calendar,
  RefreshCw,
  Mail,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button, LoadingState, PageSurface, Tabs, Tooltip, EmptyState } from '@/components/ui';
import { PAGE_METADATA } from '@/config/pageMetadata';
import { AudioPlayer } from '@/features/transcript/components/AudioPlayer';
import { NewInsideSalesEvalOverlay } from '../components/NewInsideSalesEvalOverlay';
import { CallResultPanel } from '../components/CallResultPanel';
import { fetchThreadHistory } from '@/services/api/evalRunsApi';
import { useInsideSalesStore } from '@/stores';
import type { ThreadEvalRow } from '@/types';
import { apiRequest } from '@/services/api/client';
import { cn } from '@/utils';
import { formatDuration } from '@/utils/formatters';
import { routes } from '@/config/routes';
import { InlineReviewProvider, StartReviewButton } from '@/features/reviews/inline';
import { usePermission } from '@/utils/permissions';

interface LeadDetail {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  cached: boolean;
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-IN', {
      weekday: 'short',
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

export function InsideSalesCallDetail() {
  const navigate = useNavigate();
  const { activityId } = useParams<{ activityId: string }>();
  const activeCall = useInsideSalesStore((s) => s.activeCall);
  const calls = useInsideSalesStore((s) => s.calls);

  // Prefer activeCall (set on row click), fall back to searching the loaded page
  const call = useMemo(
    () => (activeCall?.activityId === activityId ? activeCall : calls.find((c) => c.activityId === activityId)) ?? null,
    [activeCall, calls, activityId]
  );

  const [leadData, setLeadData] = useState<LeadDetail | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalHistory, setEvalHistory] = useState<ThreadEvalRow[]>([]);
  const [evalIdx, setEvalIdx] = useState(0);
  const [evalLoading, setEvalLoading] = useState(false);
  const canReview = usePermission('review:manage');
  const activeRunId = evalHistory[evalIdx]?.run_id ?? '';

  const fetchLead = useCallback(async (prospectId: string, refresh = false) => {
    setLeadLoading(true);
    try {
      const url = refresh
        ? `/api/inside-sales/leads/${prospectId}?refresh=true`
        : `/api/inside-sales/leads/${prospectId}`;
      const data = await apiRequest<LeadDetail>(url);
      setLeadData(data);
    } catch {
      // silently fail — lead data is supplemental
    } finally {
      setLeadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (call?.prospectId) {
      fetchLead(call.prospectId);
    }
  }, [call?.prospectId, fetchLead]);

  useEffect(() => {
    if (!call?.activityId) return;
    setEvalLoading(true);
    fetchThreadHistory(call.activityId)
      .then((r) => setEvalHistory(r.history))
      .catch(() => { /* supplemental — silent fail */ })
      .finally(() => setEvalLoading(false));
  }, [call?.activityId]);

  useEffect(() => { setEvalIdx(0); }, [call?.activityId]);

  if (!call) {
    return (
      <PageSurface
        icon={PAGE_METADATA.callDetail.icon}
        title="Call"
        back={{ to: routes.insideSales.listingForTab('calls'), label: 'Calls' }}
      >
        <EmptyState
          icon={PhoneIcon}
          title="Call not found"
          description="This call may not be loaded. Go back to the listing and try again."
          action={{ label: 'Back to Calls', onClick: () => navigate(routes.insideSales.listingForTab('calls')) }}
          fill
        />
      </PageSurface>
    );
  }

  const isInbound = call.direction === 'inbound';
  const isAnswered = call.status.toLowerCase() === 'answered';
  const disabledReason = !isAnswered
    ? 'Cannot evaluate missed calls'
    : !call.recordingUrl
    ? 'No recording available'
    : undefined;

  const leadName = leadData && (leadData.firstName || leadData.lastName)
    ? [leadData.firstName, leadData.lastName].filter(Boolean).join(' ')
    : null;
  const titleText = leadName
    ? `${call.agentName || 'Unknown Agent'} → ${leadName}`
    : call.agentName || 'Unknown Agent';

  const metaTooltip = (
    <div className="flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
      <div className="flex items-center gap-2">
        <Calendar className="h-3 w-3 text-[var(--text-muted)]" />
        <span>{formatDateTime(call.callStartTime)}</span>
      </div>
      <div className="flex items-center gap-2">
        <User className="h-3 w-3 text-[var(--text-muted)]" />
        <span>{call.agentName || '—'}</span>
      </div>
      <div className="flex items-center gap-2">
        <Users className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="font-mono">{call.prospectId || '—'}</span>
      </div>
      <div className="flex items-center gap-2">
        <Clock className="h-3 w-3 text-[var(--text-muted)]" />
        <span>{call.durationSeconds > 0 ? formatDuration(call.durationSeconds) : '—'}</span>
      </div>
      <div className="flex items-center gap-2">
        <PhoneIcon className="h-3 w-3 text-[var(--text-muted)]" />
        <span className="font-mono">{call.callSessionId ? call.callSessionId.slice(-8) : '—'}</span>
      </div>
      {leadData?.phone && (
        <div className="flex items-center gap-2">
          <PhoneIcon className="h-3 w-3 text-[var(--text-muted)]" />
          <span className="font-mono">{leadData.phone}</span>
        </div>
      )}
      {leadData?.email && (
        <div className="flex items-center gap-2">
          <Mail className="h-3 w-3 text-[var(--text-muted)]" />
          <span>{leadData.email}</span>
        </div>
      )}
      {leadData?.cached && (
        <div className="text-[10px] text-[var(--text-muted)]">(cached from LSQ)</div>
      )}
    </div>
  );

  const subtitle = (
    <>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
          isInbound ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
        )}
      >
        {isInbound ? <PhoneIncoming className="h-3 w-3" /> : <PhoneOutgoing className="h-3 w-3" />}
        {isInbound ? 'Inbound' : 'Outbound'}
      </span>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
          isAnswered ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
        )}
      >
        {isAnswered ? 'Answered' : 'Missed'}
      </span>
      <Tooltip content={metaTooltip} closeDelay={150}>
        <Info className="h-3.5 w-3.5 text-[var(--text-muted)] cursor-help" />
      </Tooltip>
      {leadData && (
        <button
          onClick={() => fetchLead(call.prospectId, true)}
          disabled={leadLoading}
          title="Refresh lead data from LSQ"
          className={cn(
            'rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors',
            leadLoading && 'animate-spin'
          )}
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </>
  );

  const actions = (
    <>
      {evalHistory.length > 0 && (
        <span className="inline-flex items-center gap-0.5 border border-[var(--border-subtle)] rounded-md bg-[var(--bg-secondary)]">
          <button
            disabled={evalIdx >= evalHistory.length - 1}
            onClick={() => setEvalIdx((i) => i + 1)}
            className="p-1 disabled:opacity-30 hover:bg-[var(--interactive-secondary)] rounded-l-md transition-colors cursor-pointer disabled:cursor-default"
            title="Older evaluation"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] tabular-nums px-1 border-x border-[var(--border-subtle)] text-[var(--text-secondary)]">
            {evalHistory.length - evalIdx}/{evalHistory.length}
          </span>
          <button
            disabled={evalIdx <= 0}
            onClick={() => setEvalIdx((i) => i - 1)}
            className="p-1 disabled:opacity-30 hover:bg-[var(--interactive-secondary)] rounded-r-md transition-colors cursor-pointer disabled:cursor-default"
            title="Newer evaluation"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
      {activeRunId && <StartReviewButton runId={activeRunId} />}
      <span title={disabledReason} className={disabledReason ? 'cursor-not-allowed' : undefined}>
        <Button size="sm" disabled={!!disabledReason} onClick={() => setEvalOpen(true)}>
          Evaluate
        </Button>
      </span>
    </>
  );

  return (
    <InlineReviewProvider runId={activeRunId} appId="inside-sales" enabled={canReview && !!activeRunId}>
      <PageSurface
        icon={PAGE_METADATA.callDetail.icon}
        title={titleText}
        subtitle={subtitle}
        back={{ to: routes.insideSales.listingForTab('calls'), label: 'Calls' }}
        actions={actions}
        showHeader={!evalLoading}
      >
        {evalLoading ? (
          <LoadingState />
        ) : evalHistory.length > 0 ? (
          <div className="flex flex-col flex-1 min-h-0">
            <CallResultPanel
              thread={evalHistory[evalIdx]}
              recordingUrl={call.recordingUrl || undefined}
              appId="inside-sales"
            />
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <Tabs
              tabs={[
                {
                  id: 'transcript',
                  label: 'Transcript',
                  content: (
                    <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
                      {call.recordingUrl && (
                        <AudioPlayer audioUrl={call.recordingUrl} appId="inside-sales" />
                      )}
                      <EmptyState
                        icon={PhoneIcon}
                        title="No transcript yet"
                        description="Transcription will be available after evaluation."
                        compact
                        fill
                      />
                    </div>
                  ),
                },
                {
                  id: 'scorecard',
                  label: 'Scorecard',
                  content: (
                    <EmptyState
                      icon={PhoneIcon}
                      title="Not yet evaluated"
                      description="Run an evaluation to see the scorecard."
                      compact
                      fill
                    />
                  ),
                },
              ]}
              defaultTab="transcript"
              fillHeight
              mountStrategy="active-only"
            />
          </div>
        )}

        {evalOpen && (
          <NewInsideSalesEvalOverlay
            onClose={() => setEvalOpen(false)}
            preSelectedCallIds={[call.activityId]}
          />
        )}
      </PageSurface>
    </InlineReviewProvider>
  );
}
