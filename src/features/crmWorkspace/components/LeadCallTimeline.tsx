/**
 * Call Timeline tab content — table of all calls for a lead.
 *
 * Audio is played inline: clicking the row's play button toggles playback
 * on a single shared `<audio>` element. No route navigation — the sales
 * agent should be able to hear a call without losing lead context.
 */
import { useEffect, useRef, useState } from 'react';
import { Pause, Phone, Play } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { cn } from '@/utils';
import { formatDuration } from '@/utils/formatters';
import { scoreColor } from '@/utils/scoreUtils';
import type { LeadCallRecord } from '@/services/api/insideSales';

interface LeadCallTimelineProps {
  callHistory: LeadCallRecord[];
  /** activityId of the call currently shown in the Evaluations tab, for accent highlight */
  activeEvalActivityId?: string | null;
}

function formatCallDateTime(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function CallStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const style =
    s === 'answered' ? 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]' :
    s === 'callfailure' || s === 'call failure' ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]' :
    'bg-[color-mix(in_srgb,var(--color-error)_15%,transparent)] text-[var(--color-error)]';
  const label =
    s === 'answered' ? 'Answered' :
    s === 'callfailure' || s === 'call failure' ? 'Call Failure' :
    'Not Answered';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', style)}>
      {label}
    </span>
  );
}

export function LeadCallTimeline({ callHistory, activeEvalActivityId }: LeadCallTimelineProps) {
  /** Single shared audio element so toggling between rows auto-stops the
   *  previous clip — matches how agents typically sample recordings. */
  const audioRef = useRef<HTMLAudioElement | null>(
    typeof Audio !== 'undefined' ? new Audio() : null,
  );
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (el) {
        el.pause();
        el.src = '';
      }
    };
  }, []);

  const togglePlayback = (call: LeadCallRecord) => {
    const el = audioRef.current;
    if (!el || !call.recordingUrl) return;
    if (playingId === call.activityId) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = call.recordingUrl;
    const playPromise = el.play();
    // `HTMLMediaElement.play()` returns a Promise in evergreen browsers but
    // not all runtimes; guard the `.catch` so the TS compiler doesn't complain
    // and so test environments without an audio backend don't throw.
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => setPlayingId(null));
    }
    setPlayingId(call.activityId);
    el.onended = () => setPlayingId(null);
  };

  if (callHistory.length === 0) {
    return (
      <EmptyState
        icon={Phone}
        title="No call activity yet"
        description="Calls to this lead will appear here once they're synced from LSQ."
        fill
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[var(--bg-secondary)] z-10">
          <tr className="border-b border-[var(--border-subtle)]">
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Time</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Agent</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Duration</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Status</th>
            <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Eval</th>
            <th className="w-8 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {callHistory.map((call) => {
            const isActive = call.activityId === activeEvalActivityId;
            const isPlaying = playingId === call.activityId;
            return (
              <tr
                key={call.activityId}
                className={cn(
                  'border-b border-[var(--border-subtle)] transition-colors last:border-b-0',
                  isActive && 'bg-[var(--surface-brand-subtle)]',
                )}
              >
                <td className="px-3 py-2.5 text-[var(--text-primary)] whitespace-nowrap">
                  {formatCallDateTime(call.callTime)}
                </td>
                <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                  {call.repName || '—'}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 tabular-nums whitespace-nowrap',
                    call.isCounseling
                      ? 'font-semibold text-[var(--color-success)]'
                      : 'text-[var(--text-secondary)]',
                  )}
                >
                  {call.durationSeconds > 0 ? formatDuration(call.durationSeconds) : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <CallStatusBadge status={call.status} />
                </td>
                <td className="px-3 py-2.5">
                  {call.evalScore !== null ? (
                    <span
                      style={{ color: scoreColor(call.evalScore) }}
                      className="text-xs font-mono font-semibold"
                    >
                      {Math.round(call.evalScore)}
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </td>
                <td className="w-8 px-2 py-2.5">
                  {call.recordingUrl ? (
                    <button
                      onClick={() => togglePlayback(call)}
                      aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
                      title={isPlaying ? 'Pause' : 'Play recording'}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                        isPlaying
                          ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                          : 'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)] hover:bg-[color-mix(in_srgb,var(--interactive-primary)_20%,transparent)]',
                      )}
                    >
                      {isPlaying ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="text-[var(--text-muted)] text-[10px]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
