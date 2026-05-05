import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/utils';
import { scoreColor } from '@/utils/scoreUtils';
import { AudioPlayer } from '@/features/transcript/components/AudioPlayer';
import { Badge, DataTable, EmptyState, Tooltip } from '@/components/ui';
import type { ColumnDef } from '@/components/ui';
import { findBestMatch } from '@/features/transcript/utils/transcriptHighlight';
import type { ThreadEvalRow, AppId } from '@/types';

interface CallResultPanelProps {
  thread: ThreadEvalRow;
  recordingUrl?: string;
  appId?: AppId;
}

export function CallResultPanel({ thread, recordingUrl, appId }: CallResultPanelProps) {
  const [activeTab, setActiveTab] = useState<'scorecard' | 'compliance' | 'signals'>('scorecard');
  const [activeQuote, setActiveQuote] = useState<string | null>(null);
  const [trackedThreadId, setTrackedThreadId] = useState(thread.thread_id);
  const highlightRef = useRef<HTMLSpanElement>(null);

  // Reset highlighted quote when navigating between calls — React-recommended
  // "adjust state during render" pattern (avoids cascading effect renders).
  if (trackedThreadId !== thread.thread_id) {
    setTrackedThreadId(thread.thread_id);
    setActiveQuote(null);
  }

  const result = thread.result as unknown as Record<string, unknown> | undefined;
  const evals = result?.evaluations as Array<Record<string, unknown>> | undefined;
  const evalOutput = evals?.[0]?.output as Record<string, unknown> | undefined;
  const signals = Array.isArray(result?.signals) ? (result.signals as SignalEntry[]) : [];
  const reasoningRaw = evalOutput?.reasoning;
  const reasoningItems: ReasoningItem[] = Array.isArray(reasoningRaw)
    ? (reasoningRaw as ReasoningItem[])
    : typeof reasoningRaw === 'string'
    ? parseReasoningString(reasoningRaw)
    : [];
  const transcript = result?.transcript as string | undefined;

  let overallScore: number | null = null;
  if (evalOutput && typeof evalOutput.overall_score === 'number') {
    overallScore = evalOutput.overall_score;
  } else {
    const topOutput = result?.output as Record<string, unknown> | undefined;
    if (topOutput && typeof topOutput.overall_score === 'number') {
      overallScore = topOutput.overall_score;
    }
  }

  const dimensions = evalOutput
    ? Object.entries(evalOutput).filter(
        ([k, v]) => typeof v === 'number' && k !== 'overall_score'
      )
    : [];

  const complianceGates = evalOutput
    ? Object.entries(evalOutput).filter(([, v]) => typeof v === 'boolean')
    : [];

  // Scroll the highlighted span into view when activeQuote resolves to a real match.
  useEffect(() => {
    if (activeQuote && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeQuote, transcript]);

  // Build the transcript renderer once per (transcript, activeQuote) pair.
  // Reuses findBestMatch from the voice-rx semantic comparison pane.
  const transcriptContent = useMemo(() => {
    if (!transcript) return null;
    if (!activeQuote) return <span>{transcript}</span>;

    const match = findBestMatch([activeQuote], transcript);
    if (!match) return <span>{transcript}</span>;

    const before = transcript.slice(0, match.index);
    const highlighted = transcript.slice(match.index, match.index + match.length);
    const after = transcript.slice(match.index + match.length);
    return (
      <>
        <span>{before}</span>
        <span
          ref={highlightRef}
          className="bg-[var(--color-warning)]/30 text-[var(--text-primary)] px-0.5 rounded-sm border-b-2 border-[var(--color-warning)]"
        >
          {highlighted}
        </span>
        <span>{after}</span>
      </>
    );
  }, [transcript, activeQuote]);

  const handleQuoteClick = (quote: string) => {
    setActiveQuote((prev) => (prev === quote ? null : quote));
  };

  return (
    <>
      <div className="hidden md:flex flex-1 min-h-0">
        <div className="w-[35%] min-w-[280px] max-w-[420px] flex flex-col min-h-0 border-r border-[var(--border-subtle)]">
          <div className="px-3 py-2 border-b border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-muted)] uppercase">
            Transcript
          </div>
          {recordingUrl && appId && (
            <div className="shrink-0 px-3 py-2 border-b border-[var(--border-subtle)]">
              <AudioPlayer audioUrl={recordingUrl} appId={appId} />
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
            {transcript ? (
              <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed font-mono">
                {transcriptContent}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center">No transcript available.</p>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex border-b border-[var(--border-subtle)]">
            {(['scorecard', 'compliance', 'signals'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-2 text-xs font-semibold transition-colors border-b-2',
                  activeTab === tab
                    ? 'border-[var(--interactive-primary)] text-[var(--text-brand)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            {activeTab === 'scorecard' && (
              <ScorecardContent
                dimensions={dimensions}
                reasoningItems={reasoningItems}
                overallScore={overallScore}
                threadId={thread.thread_id}
              />
            )}

            {activeTab === 'compliance' && (
              <ComplianceContent
                complianceGates={complianceGates}
                threadId={thread.thread_id}
              />
            )}

            {activeTab === 'signals' && (
              <SignalsContent
                signals={signals}
                threadId={thread.thread_id}
                activeQuote={activeQuote}
                onQuoteClick={handleQuoteClick}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0 md:hidden space-y-3 overflow-y-auto">
        {recordingUrl && appId && (
          <div className="shrink-0 px-1">
            <AudioPlayer audioUrl={recordingUrl} appId={appId} />
          </div>
        )}
        {transcript && (
          <details className="shrink-0">
            <summary className="text-xs text-[var(--text-muted)] font-medium cursor-pointer py-1.5 px-1">
              Transcript
            </summary>
            <div className="max-h-[300px] overflow-y-auto px-2 py-1">
              <div className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed font-mono">
                {transcript}
              </div>
            </div>
          </details>
        )}
        {dimensions.length > 0 && (
          <div className="px-2">
            {dimensions.map(([key, val]) => {
              const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              const score = val as number;
              return (
                <div key={key} className="flex items-center justify-between py-1.5 border-b border-[var(--border-subtle)] text-xs">
                  <span className="text-[var(--text-secondary)]">{label}</span>
                  <span className="font-bold" style={{ color: scoreColor(score) }}>{score}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function ScorecardContent({
  dimensions,
  reasoningItems,
  overallScore,
  threadId,
}: {
  dimensions: Array<[string, unknown]>;
  reasoningItems: ReasoningItem[];
  overallScore: number | null;
  threadId: string;
}) {
  const maxMap = new Map(reasoningItems.map((r) => [normalizeLabel(r.dimension), r.max]));

  return (
    <div className="space-y-0">
      {dimensions.map(([key, val]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const score = val as number;
        const dimMax = maxMap.get(normalizeLabel(label)) ?? (score <= 15 ? 15 : 100);
        const ratio = dimMax > 0 ? score / dimMax : 0;
        const pctVal = Math.min(100, Math.max(0, ratio * 100));
        const bandColor = dimensionBandColor(ratio);
        const band = dimensionBand(ratio);

        return (
          <div key={`${threadId}:${key}`} className="py-2 border-b border-[var(--border-subtle)] last:border-b-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-[var(--text-primary)] flex-1 min-w-0">{label}</span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-default"
                title={`${band}: ${score}/${dimMax} (${Math.round(ratio * 100)}%)\nStrong \u226580% \u00b7 Good \u226565% \u00b7 Needs Work \u226550% \u00b7 Poor <50%`}
                style={{ color: bandColor, background: `color-mix(in srgb, ${bandColor} 12%, transparent)` }}
              >
                {band}
              </span>
              <span className="text-xs font-bold tabular-nums w-12 text-right" style={{ color: bandColor }}>
                {score}/{dimMax}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pctVal}%`, background: bandColor }}
              />
            </div>
          </div>
        );
      })}
      {overallScore !== null && (
        <div className="flex items-center justify-between mt-3 px-3 py-2.5 bg-[var(--bg-secondary)] rounded-md border border-[var(--border-subtle)]">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">Total</span>
          <span className="text-lg font-bold" style={{ color: scoreColor(overallScore) }}>
            {overallScore}/100
          </span>
        </div>
      )}
      {reasoningItems.length > 0 && <ReasoningBreakdown items={reasoningItems} />}
    </div>
  );
}

function ComplianceContent({
  complianceGates,
  threadId,
}: {
  complianceGates: Array<[string, unknown]>;
  threadId: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1 pb-3">
        <span className="px-2 py-0.5 text-xs rounded-full border border-[var(--border-brand)] bg-[var(--surface-info)] text-[var(--text-brand)]">
          All ({complianceGates.length})
        </span>
        <span className="px-2 py-0.5 text-xs rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
          Violations ({complianceGates.filter(([, v]) => !v).length})
        </span>
        <span className="px-2 py-0.5 text-xs rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
          Passed ({complianceGates.filter(([, v]) => v).length})
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            <th className="text-center w-12 py-1.5 px-2 font-semibold text-[var(--text-muted)]">Status</th>
            <th className="text-left py-1.5 px-2 font-semibold text-[var(--text-muted)]">Rule</th>
          </tr>
        </thead>
        <tbody>
          {complianceGates.map(([key, val]) => {
            const label = key.replace(/^compliance_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            const passed = val as boolean;

            return (
              <tr key={`${threadId}:${key}`} className="border-b border-[var(--border-subtle)]">
                <td className="text-center py-2 px-2">
                  <span className={cn(
                    'inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold',
                    passed
                      ? 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]'
                      : 'bg-[color-mix(in_srgb,var(--color-error)_15%,transparent)] text-[var(--color-error)]'
                  )}>
                    {passed ? '\u2713' : '\u2717'}
                  </span>
                </td>
                <td className="py-2 px-2">
                  <span className={cn(
                    'text-[13px] font-semibold',
                    passed ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                  )}>
                    {label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SignalEntry {
  signal_type: string;
  signal_value?: string | null;
  signal_value_numeric?: number | null;
  signal_at?: string | null;
  confidence?: number | null;
  supporting_quote?: string | null;
  attributes?: Record<string, unknown> | null;
}

const TAB_LABELS: Record<'scorecard' | 'compliance' | 'signals', string> = {
  scorecard: 'Scorecard',
  compliance: 'Compliance',
  signals: 'Signals',
};

function formatSignalType(signalType: string): string {
  return signalType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSignalValue(s: SignalEntry): string {
  if (s.signal_value && s.signal_value.trim()) return s.signal_value;
  if (typeof s.signal_value_numeric === 'number') {
    return Number.isInteger(s.signal_value_numeric)
      ? String(s.signal_value_numeric)
      : s.signal_value_numeric.toFixed(2);
  }
  return '—';
}

function formatSignalAt(s: SignalEntry): string {
  if (!s.signal_at) return '—';
  try {
    const d = new Date(s.signal_at);
    if (Number.isNaN(d.getTime())) return s.signal_at;
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return s.signal_at;
  }
}

function SignalsContent({
  signals,
  threadId,
  activeQuote,
  onQuoteClick,
}: {
  signals: SignalEntry[];
  threadId: string;
  activeQuote: string | null;
  onQuoteClick: (quote: string) => void;
}) {
  if (!signals.length) {
    return (
      <EmptyState
        icon={Activity}
        title="No signals extracted"
        description="The evaluator did not surface any commitments, intents, or objections from this call."
        compact
      />
    );
  }

  const columns: ColumnDef<SignalEntry & { _key: string }>[] = [
    {
      key: 'type',
      header: 'Type',
      width: 'w-[200px]',
      render: (row) => {
        const rawType = row.attributes && typeof row.attributes === 'object'
          ? (row.attributes as Record<string, unknown>).signal_type_raw
          : null;
        const labelExtra = row.signal_type === 'other_notable_signal' && typeof rawType === 'string' && rawType
          ? rawType
          : null;
        return (
          <div className="flex flex-col gap-0.5">
            <Badge>{formatSignalType(row.signal_type)}</Badge>
            {labelExtra && (
              <span className="text-[10px] text-[var(--text-muted)] pl-0.5">{labelExtra}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'value',
      header: 'Value',
      width: 'w-[140px]',
      render: (row) => (
        <span className="text-xs text-[var(--text-primary)]">{formatSignalValue(row)}</span>
      ),
    },
    {
      key: 'confidence',
      header: 'Confidence',
      width: 'w-[110px]',
      cellClassName: 'text-right tabular-nums',
      headerClassName: 'text-right',
      render: (row) =>
        typeof row.confidence === 'number'
          ? `${Math.round(row.confidence * 100)}%`
          : <span className="text-[var(--text-muted)]">—</span>,
    },
    {
      key: 'quote',
      header: 'Supporting quote',
      render: (row) => {
        if (!row.supporting_quote) {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        const quote = row.supporting_quote;
        const isActive = activeQuote === quote;
        return (
          <Tooltip content={<span className="whitespace-pre-wrap">“{quote}”</span>} maxWidth={420}>
            <button
              type="button"
              onClick={() => onQuoteClick(quote)}
              className={cn(
                'block w-full text-left text-xs italic line-clamp-2 rounded px-1 py-0.5 -mx-1 transition-colors cursor-pointer',
                isActive
                  ? 'bg-[var(--color-warning)]/15 text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              )}
            >
              “{quote}”
            </button>
          </Tooltip>
        );
      },
    },
    {
      key: 'when',
      header: 'When',
      width: 'w-[170px]',
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)] tabular-nums">
          {formatSignalAt(row)}
        </span>
      ),
    },
  ];

  const rows = signals.map((s, i) => ({ ...s, _key: `${threadId}:${i}:${s.signal_type}` }));

  return (
    <DataTable
      columns={columns}
      data={rows}
      keyExtractor={(r) => r._key}
      minWidth="720px"
      stickyHeader={false}
    />
  );
}

interface ReasoningItem {
  dimension: string;
  score: number;
  max: number;
  explanation: string;
}

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseReasoningString(text: string): ReasoningItem[] {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^(.+?)\s*\((\d+)\/(\d+)\)\s*:\s*([\s\S]+)/);
      if (match) {
        return {
          dimension: match[1].trim(),
          score: Number(match[2]),
          max: Number(match[3]),
          explanation: match[4].trim(),
        };
      }
      return { dimension: '', score: 0, max: 0, explanation: block };
    })
    .filter((b) => b.dimension);
}

function dimensionBand(ratio: number): string {
  if (ratio >= 0.8) return 'Strong';
  if (ratio >= 0.65) return 'Good';
  if (ratio >= 0.5) return 'Needs work';
  return 'Poor';
}

function dimensionBandColor(ratio: number): string {
  if (ratio >= 0.8) return 'var(--color-success)';
  if (ratio >= 0.65) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function ReasoningBreakdown({ items }: { items: ReasoningItem[] }) {
  if (!items.length) return null;

  return (
    <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
      <h4 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Reasoning</h4>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            <th className="text-left py-1.5 px-2 font-semibold text-[var(--text-muted)] w-[36%]">Dimension</th>
            <th className="text-center py-1.5 px-2 font-semibold text-[var(--text-muted)] w-[10%]">Score</th>
            <th className="text-left py-1.5 px-2 font-semibold text-[var(--text-muted)]">Feedback</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const ratio = item.max > 0 ? item.score / item.max : 0;
            const color = dimensionBandColor(ratio);
            return (
              <tr key={i} className="border-b border-[var(--border-subtle)] last:border-b-0 align-top">
                <td className="py-2 px-2 font-medium text-[var(--text-primary)]">{item.dimension}</td>
                <td className="py-2 px-2 text-center font-bold tabular-nums" style={{ color }}>
                  {item.score}/{item.max}
                </td>
                <td className="py-2 px-2 text-[var(--text-secondary)] leading-relaxed">{item.explanation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
