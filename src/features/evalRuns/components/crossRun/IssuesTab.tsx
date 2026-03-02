import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Loader2, Sparkles, MessageSquare, Clock } from 'lucide-react';
import type {
  IssuesAndRecommendations,
  AggregatedIssue,
  AggregatedRecommendation,
  CrossRunStats,
  CrossRunAISummary,
  HealthTrendPoint,
} from '@/types/crossRunAnalytics';
import type { LLMProvider } from '@/types';
import { cn } from '@/utils';
import { EmptyState, Button, LLMConfigSection } from '@/components/ui';
import { jobsApi, type Job } from '@/services/api/jobsApi';
import { poll } from '@/services/api/jobPolling';
import { notificationService } from '@/services/notifications';
import { hasProviderCredentials, useLLMSettingsStore, LLM_PROVIDERS } from '@/stores';
import SectionHeader from '../report/shared/SectionHeader';
import CalloutBox from '../report/shared/CalloutBox';
import {
  PRIORITY_STYLES,
  PRIORITY_DOT_COLORS,
  rankToPriority,
  parseImpactSegments,
} from '../report/shared/colors';

interface Props {
  data: IssuesAndRecommendations;
  stats: CrossRunStats;
  healthTrend: HealthTrendPoint[];
}

export default function IssuesTab({ data, stats, healthTrend }: Props) {
  const [aiSummary, setAiSummary] = useState<CrossRunAISummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Model selection state
  const [provider, setProvider] = useState<LLMProvider>(LLM_PROVIDERS[0].value);
  const [model, setModel] = useState('');

  // Close picker on outside click
  useEffect(() => {
    if (!showModelPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModelPicker]);

  const [progressMsg, setProgressMsg] = useState('');

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setShowModelPicker(false);
    setProgressMsg('Submitting job...');
    try {
      const job = await jobsApi.submit('generate-cross-run-report', {
        app_id: 'kaira-bot',
        stats: stats as unknown as Record<string, unknown>,
        health_trend: healthTrend as unknown as Record<string, unknown>[],
        top_issues: data.issues.slice(0, 10) as unknown as Record<string, unknown>[],
        top_recommendations: data.recommendations.slice(0, 10) as unknown as Record<string, unknown>[],
        provider,
        model: model || undefined,
      });

      const finalJob = await poll<Job>({
        fn: async () => {
          const j = await jobsApi.get(job.id);
          if (j.status === 'queued') {
            const pos = j.queuePosition ?? 0;
            setProgressMsg(pos > 0 ? `Queued \u2014 ${pos} job${pos > 1 ? 's' : ''} ahead` : 'Queued \u2014 next in line');
          } else if (j.status === 'running') {
            setProgressMsg(j.progress?.message || 'Generating...');
          }
          if (['completed', 'failed', 'cancelled'].includes(j.status)) {
            return { done: true, data: j };
          }
          return { done: false };
        },
        intervalMs: 5000,
      });

      if (finalJob?.status === 'completed' && finalJob.result?.summary) {
        setAiSummary(finalJob.result.summary as unknown as CrossRunAISummary);
        notificationService.success('AI summary generated');
      } else if (finalJob?.status === 'failed') {
        notificationService.error(finalJob.errorMessage || 'AI summary generation failed');
      } else if (finalJob?.status === 'cancelled') {
        notificationService.warning('AI summary generation was cancelled');
      }
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'AI summary generation failed');
    } finally {
      setGenerating(false);
      setProgressMsg('');
    }
  }, [stats, healthTrend, data, provider, model]);

  const noData = data.issues.length === 0 && data.recommendations.length === 0;

  if (noData) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No AI narratives found"
        description="No AI narratives generated across runs. Generate reports with AI narrative to see cross-run patterns."
        compact
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <CalloutBox variant="info">
        <span className="text-xs">
          Aggregated from {data.runsWithNarrative} of {stats.totalRuns} runs with AI narrative.
          {data.runsWithoutNarrative > 0 && (
            <> Generate reports with AI narrative on the remaining {data.runsWithoutNarrative} run{data.runsWithoutNarrative > 1 ? 's' : ''} for better coverage.</>
          )}
        </span>
      </CalloutBox>

      {/* AI Summary section */}
      {data.runsWithNarrative > 0 && (
        <div>
          {!aiSummary && !generating && (
            <div className="relative inline-block" ref={pickerRef}>
              <Button
                variant="secondary"
                size="sm"
                icon={Sparkles}
                onClick={() => setShowModelPicker(!showModelPicker)}
              >
                Generate AI Summary
              </Button>

              {showModelPicker && (
                <div className="absolute top-full mt-2 left-0 w-[320px] bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-lg shadow-lg p-4 space-y-3 z-30">
                  <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    Select Model
                  </div>

                  <LLMConfigSection
                    provider={provider}
                    onProviderChange={(p) => { setProvider(p); setModel(''); }}
                    model={model}
                    onModelChange={setModel}
                    compact
                  />

                  <Button
                    variant="primary"
                    size="sm"
                    icon={Sparkles}
                    onClick={handleGenerate}
                    disabled={!hasProviderCredentials(provider, useLLMSettingsStore.getState()) || !model}
                    className="w-full"
                  >
                    Generate
                  </Button>
                </div>
              )}
            </div>
          )}

          {generating && (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--text-secondary)]">
              {progressMsg.startsWith('Queued') ? (
                <Clock className="h-4 w-4 text-[var(--text-muted)]" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)]" />
              )}
              {progressMsg || 'Generating AI cross-run summary...'}
            </div>
          )}

          {aiSummary && <AISummaryCard summary={aiSummary} />}
        </div>
      )}

      {/* Recurring Issues */}
      {data.issues.length > 0 && (
        <div>
          <SectionHeader title="Recurring Issues" description="Issues grouped by area across multiple runs." />
          <IssuesTable issues={data.issues} />
        </div>
      )}

      {/* Recurring Recommendations — grouped by priority */}
      {data.recommendations.length > 0 && (
        <div>
          <SectionHeader title="Recurring Recommendations" description="Recommendations grouped by area, sorted by priority." />
          <div className="space-y-6">
            {(['P0', 'P1', 'P2'] as const).map((priority) => {
              const group = data.recommendations.filter((r) => r.highestPriority === priority);
              if (group.length === 0) return null;
              return (
                <div key={priority}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                    {PRIORITY_STYLES[priority].label}
                  </h4>
                  <RecommendationsTable items={group} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Issues Table ──

function IssuesTable({ issues }: { issues: AggregatedIssue[] }) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  const toggle = (area: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[var(--border-subtle)]">
            <th style={{ width: 12 }} className="px-2 py-1.5" />
            <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Area</th>
            <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Top Description</th>
            <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">Runs</th>
            <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">Threads Affected</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, i) => {
            const priority = rankToPriority(issue.worstRank);
            const dotColor = PRIORITY_DOT_COLORS[priority] || '#6b7280';
            const hasMore = issue.descriptions.length > 1;
            const expanded = expandedAreas.has(issue.area);

            return (
              <IssueTableRows
                key={issue.area}
                issue={issue}
                dotColor={dotColor}
                hasMore={hasMore}
                expanded={expanded}
                onToggle={() => toggle(issue.area)}
                rowIndex={i}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IssueTableRows({
  issue,
  dotColor,
  hasMore,
  expanded,
  onToggle,
  rowIndex,
}: {
  issue: AggregatedIssue;
  dotColor: string;
  hasMore: boolean;
  expanded: boolean;
  onToggle: () => void;
  rowIndex: number;
}) {
  const stripeBg = rowIndex % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]';

  return (
    <>
      <tr className={cn(stripeBg, hasMore && 'cursor-pointer')} onClick={hasMore ? onToggle : undefined}>
        <td className="px-2 py-2 align-top">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
        </td>
        <td className="px-2 py-2 align-top font-semibold text-[var(--text-primary)] whitespace-nowrap">
          <div className="flex items-center gap-1">
            {hasMore && (
              expanded
                ? <ChevronDown className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                : <ChevronRight className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
            )}
            {issue.area}
          </div>
        </td>
        <td className="px-2 py-2 align-top text-[var(--text-secondary)]">{issue.descriptions[0]}</td>
        <td className="px-2 py-2 align-top text-right text-[var(--text-muted)] whitespace-nowrap">{issue.runCount}</td>
        <td className="px-2 py-2 align-top text-right text-[var(--text-muted)] whitespace-nowrap">{issue.totalAffected}</td>
      </tr>
      {expanded && issue.descriptions.slice(1).map((desc, j) => (
        <tr key={`${issue.area}-${j}`} className={stripeBg}>
          <td className="px-2 py-1" />
          <td className="px-2 py-1" />
          <td className="px-2 py-1 text-xs text-[var(--text-muted)]">{desc}</td>
          <td className="px-2 py-1" />
          <td className="px-2 py-1" />
        </tr>
      ))}
    </>
  );
}

// ── Recommendations Table ──

function RecommendationsTable({ items }: { items: AggregatedRecommendation[] }) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  const toggle = (area: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[var(--border-subtle)]">
            <th style={{ width: 12 }} className="px-2 py-1.5" />
            <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Action</th>
            <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">Area</th>
            <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">Runs</th>
            <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">Projected Impact</th>
          </tr>
        </thead>
        <tbody>
          {items.map((rec, i) => {
            const dotColor = PRIORITY_DOT_COLORS[rec.highestPriority] ?? '#6b7280';
            const hasMore = rec.actions.length > 1 || rec.estimatedImpacts.length > 1;
            const expanded = expandedAreas.has(rec.area);

            return (
              <RecommendationTableRows
                key={rec.area}
                rec={rec}
                dotColor={dotColor}
                hasMore={hasMore}
                expanded={expanded}
                onToggle={() => toggle(rec.area)}
                rowIndex={i}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationTableRows({
  rec,
  dotColor,
  hasMore,
  expanded,
  onToggle,
  rowIndex,
}: {
  rec: AggregatedRecommendation;
  dotColor: string;
  hasMore: boolean;
  expanded: boolean;
  onToggle: () => void;
  rowIndex: number;
}) {
  const stripeBg = rowIndex % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]';
  const firstImpact = rec.estimatedImpacts[0];
  const firstSegments = firstImpact ? parseImpactSegments(firstImpact) : [];

  return (
    <>
      <tr className={cn(stripeBg, hasMore && 'cursor-pointer')} onClick={hasMore ? onToggle : undefined}>
        <td className="px-2 py-2.5 align-top">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
        </td>
        <td className="px-2 py-2.5 align-top font-medium text-[var(--text-primary)]">
          <div className="flex items-center gap-1">
            {hasMore && (
              expanded
                ? <ChevronDown className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
                : <ChevronRight className="h-3 w-3 text-[var(--text-muted)] shrink-0" />
            )}
            {rec.actions[0]}
          </div>
        </td>
        <td className="px-2 py-2.5 align-top text-[var(--text-muted)] whitespace-nowrap">{rec.area}</td>
        <td className="px-2 py-2.5 align-top text-right text-[var(--text-muted)] whitespace-nowrap">{rec.runCount}</td>
        <td className="px-2 py-2.5 align-top text-right text-xs">
          <ImpactCell segments={firstSegments} />
        </td>
      </tr>
      {expanded && rec.actions.slice(1).map((action, j) => {
        const impact = rec.estimatedImpacts[j + 1];
        const segments = impact ? parseImpactSegments(impact) : [];
        return (
          <tr key={`${rec.area}-a-${j}`} className={stripeBg}>
            <td className="px-2 py-1" />
            <td className="px-2 py-1 text-xs text-[var(--text-secondary)]">{action}</td>
            <td className="px-2 py-1" />
            <td className="px-2 py-1" />
            <td className="px-2 py-1 text-right text-xs">
              <ImpactCell segments={segments} />
            </td>
          </tr>
        );
      })}
      {/* Show remaining impacts that don't pair with an action */}
      {expanded && rec.estimatedImpacts.slice(rec.actions.length).map((impact, j) => {
        const segments = parseImpactSegments(impact);
        return (
          <tr key={`${rec.area}-i-${j}`} className={stripeBg}>
            <td className="px-2 py-1" />
            <td className="px-2 py-1" />
            <td className="px-2 py-1" />
            <td className="px-2 py-1" />
            <td className="px-2 py-1 text-right text-xs">
              <ImpactCell segments={segments} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ImpactCell({ segments }: { segments: ReturnType<typeof parseImpactSegments> }) {
  if (segments.length === 0) return <span className="text-[var(--text-muted)]">&mdash;</span>;

  return (
    <div className="space-y-1">
      {segments.map((seg, j) => (
        <div key={j} className="text-[var(--color-success)]">
          {seg.arrow && <span>{seg.arrow}{seg.count} </span>}
          <code className="text-[11px] bg-[var(--surface-success)] px-1 py-px rounded text-[var(--color-success)]">
            {seg.label}
          </code>
        </div>
      ))}
    </div>
  );
}

// ── AI Summary Card ──

function AISummaryCard({ summary }: { summary: CrossRunAISummary }) {
  return (
    <div className="mt-4">
      <CalloutBox variant="insight" title="AI Cross-Run Summary">
        <div className="space-y-3 mt-2">
          <div>
            <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-[var(--text-brand)]" />
              Executive Summary
            </h4>
            <p className="text-xs leading-relaxed">{summary.executiveSummary}</p>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-2">
            <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Trend Analysis</h4>
            <p className="text-xs leading-relaxed">{summary.trendAnalysis}</p>
          </div>

          {summary.criticalPatterns.length > 0 && (
            <div className="border-t border-[var(--border-subtle)] pt-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Critical Patterns</h4>
              <ul className="list-disc list-inside space-y-0.5">
                {summary.criticalPatterns.map((p, i) => (
                  <li key={i} className="text-xs">{p}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.strategicRecommendations.length > 0 && (
            <div className="border-t border-[var(--border-subtle)] pt-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Strategic Recommendations</h4>
              <ol className="list-decimal list-inside space-y-0.5">
                {summary.strategicRecommendations.map((r, i) => (
                  <li key={i} className="text-xs">{r}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </CalloutBox>
    </div>
  );
}
