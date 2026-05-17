import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, MessageSquare, Clock } from 'lucide-react';
import type {
  IssuesAndRecommendations,
  AggregatedRecommendation,
  CrossRunStats,
  CrossRunAISummary,
  HealthTrendPoint,
} from '@/types/crossRunAnalytics';
import type { AppId } from '@/types';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import { EmptyState, Button, LegacyLlmConfigCompat } from '@/components/ui';
import { jobsApi, type Job } from '@/services/api/jobsApi';
import { getAdaptiveJobPollBackoffMs, isTerminalJobStatus, poll } from '@/services/api/jobPolling';
import { notificationService } from '@/services/notifications';
import SectionHeader from '../report/shared/SectionHeader';
import CalloutBox from '../report/shared/CalloutBox';
import { rankToPriority, parseImpactSegments } from '../report/shared/colors';
import InsightPanel from './InsightPanel';
import type { InsightPanelItem } from './InsightPanel';

interface Props {
  appId: AppId;
  data: IssuesAndRecommendations;
  stats: CrossRunStats;
  healthTrend: HealthTrendPoint[];
}

export default function IssuesTab({ appId, data, stats, healthTrend }: Props) {
  const [aiSummary, setAiSummary] = useState<CrossRunAISummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Model selection state — empty until the user picks from the admin-
  // configured providers in LlmModelSelect.
  const [provider, setProvider] = useState<LLMProvider | ''>('');
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
        app_id: appId,
        stats: stats as unknown as Record<string, unknown>,
        health_trend: healthTrend as unknown as Record<string, unknown>[],
        top_issues: data.issues.slice(0, 10) as unknown as Record<string, unknown>[],
        top_recommendations: data.recommendations.slice(0, 10) as unknown as Record<string, unknown>[],
        provider,
        model: model || undefined,
      });

      let latestJob: Job | null = null;
      const finalJob = await poll<Job>({
        fn: async () => {
          const j = await jobsApi.get(job.id);
          latestJob = j;
          if (j.status === 'queued') {
            const pos = j.queuePosition ?? 0;
            setProgressMsg(pos > 0 ? `Queued \u2014 ${pos} job${pos > 1 ? 's' : ''} ahead` : 'Queued \u2014 next in line');
          } else if (j.status === 'retryable_failed') {
            setProgressMsg(j.progress?.message || 'Retry scheduled...');
          } else if (j.status === 'running') {
            setProgressMsg(j.progress?.message || 'Generating...');
          }
          if (isTerminalJobStatus(j.status)) {
            return { done: true, data: j };
          }
          return { done: false };
        },
        intervalMs: 2000,
        getBackoffMs: () => getAdaptiveJobPollBackoffMs(latestJob, 2000),
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
  }, [appId, stats, healthTrend, data, provider, model]);

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

                  <LegacyLlmConfigCompat
                    callSite="chat_text"
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
                    disabled={!provider || !model}
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
          <div className="space-y-2">
            {data.issues.map((issue) => (
              <InsightPanel
                key={issue.area}
                area={issue.area}
                priority={rankToPriority(issue.worstRank)}
                runCount={issue.runCount}
                items={issue.descriptions.map((d) => ({ text: d }))}
                stats={[{ label: 'affected', value: String(issue.totalAffected) }]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recurring Recommendations */}
      {data.recommendations.length > 0 && (
        <div>
          <SectionHeader title="Recurring Recommendations" description="Recommendations grouped by area, sorted by priority." />
          <div className="space-y-2">
            {sortByPriority(data.recommendations).map((rec) => {
              const panelItems = buildRecItems(rec);
              const allSegments = rec.estimatedImpacts.flatMap(parseImpactSegments);
              const totalFixes = allSegments
                .filter((s) => s.arrow === '↓')
                .reduce((sum, s) => sum + (parseInt(s.count, 10) || 0), 0);

              return (
                <InsightPanel
                  key={rec.area}
                  area={rec.area}
                  priority={rec.highestPriority}
                  runCount={rec.runCount}
                  items={panelItems}
                  stats={[
                    { label: rec.actions.length === 1 ? 'action' : 'actions', value: String(rec.actions.length) },
                    { label: 'fixes', value: `\u2193${totalFixes}`, success: true },
                  ]}
                  footerImpacts={panelItems.length > 3 ? allSegments : undefined}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

function sortByPriority(recs: AggregatedRecommendation[]): AggregatedRecommendation[] {
  return [...recs].sort(
    (a, b) => (PRIORITY_ORDER[a.highestPriority] ?? 9) - (PRIORITY_ORDER[b.highestPriority] ?? 9),
  );
}

function buildRecItems(rec: AggregatedRecommendation): InsightPanelItem[] {
  const items: InsightPanelItem[] = rec.actions.map((action, i) => ({
    text: action,
    impacts: rec.estimatedImpacts[i] ? parseImpactSegments(rec.estimatedImpacts[i]) : undefined,
  }));
  // Append orphan impacts (more impacts than actions) to last item
  if (rec.estimatedImpacts.length > rec.actions.length && items.length > 0) {
    const orphans = rec.estimatedImpacts.slice(rec.actions.length).flatMap(parseImpactSegments);
    const last = items[items.length - 1];
    last.impacts = [...(last.impacts ?? []), ...orphans];
  }
  return items;
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

          {(summary.criticalPatterns ?? []).length > 0 && (
            <div className="border-t border-[var(--border-subtle)] pt-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Critical Patterns</h4>
              <ul className="list-disc list-inside space-y-0.5">
                {(summary.criticalPatterns ?? []).map((p, i) => (
                  <li key={i} className="text-xs">{p}</li>
                ))}
              </ul>
            </div>
          )}

          {(summary.strategicRecommendations ?? []).length > 0 && (
            <div className="border-t border-[var(--border-subtle)] pt-2">
              <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Strategic Recommendations</h4>
              <ol className="list-decimal list-inside space-y-0.5">
                {(summary.strategicRecommendations ?? []).map((r, i) => (
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
