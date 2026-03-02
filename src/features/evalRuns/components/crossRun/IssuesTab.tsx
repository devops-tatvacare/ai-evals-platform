import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Info, Loader2, Sparkles, MessageSquare } from 'lucide-react';
import type {
  IssuesAndRecommendations,
  CrossRunStats,
  CrossRunAISummary,
  CrossRunAISummaryRequest,
  HealthTrendPoint,
} from '@/types/crossRunAnalytics';
import type { LLMProvider } from '@/types';
import { cn } from '@/utils';
import { EmptyState, Button } from '@/components/ui';
import { reportsApi } from '@/services/api/reportsApi';
import { notificationService } from '@/services/notifications';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { useLLMSettingsStore, hasLLMCredentials } from '@/stores';
import { providerIcons } from '@/components/ui/ModelBadge/providers';
import SectionHeader from '../report/shared/SectionHeader';
import { PRIORITY_STYLES, PRIORITY_DOT_COLORS, rankToPriority } from '../report/shared/colors';

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
  const [provider, setProvider] = useState<LLMProvider>('gemini');
  const [model, setModel] = useState('');
  const credentialsReady = useLLMSettingsStore(hasLLMCredentials);
  const apiKey = useLLMSettingsStore((s) => s.apiKey);

  // Pre-fill from store
  useEffect(() => {
    const s = useLLMSettingsStore.getState();
    setProvider(s.provider);
    setModel('');
  }, []);

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

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setShowModelPicker(false);
    try {
      const payload: CrossRunAISummaryRequest = {
        appId: 'kaira-bot',
        stats: stats as unknown as Record<string, unknown>,
        healthTrend: healthTrend as unknown as Record<string, unknown>[],
        topIssues: data.issues.slice(0, 10) as unknown as Record<string, unknown>[],
        topRecommendations: data.recommendations.slice(0, 10) as unknown as Record<string, unknown>[],
        provider,
        model: model || undefined,
      };
      const result = await reportsApi.generateCrossRunSummary(payload);
      setAiSummary(result);
      notificationService.success('AI summary generated');
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'AI summary generation failed');
    } finally {
      setGenerating(false);
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
      <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--surface-info)] border border-[var(--border-info)] text-xs text-[var(--text-secondary)]">
        <Info className="h-3.5 w-3.5 shrink-0 text-[var(--color-info)]" />
        Aggregated from {data.runsWithNarrative} of {stats.totalRuns} runs with AI narrative.
        {data.runsWithoutNarrative > 0 && ` (${data.runsWithoutNarrative} runs without narrative)`}
      </div>

      {/* AI Summary section — positioned at top for visibility */}
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

                  {/* Provider toggle */}
                  <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                    {(['gemini', 'openai'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => { setProvider(p); setModel(''); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                          provider === p
                            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        }`}
                      >
                        <img src={providerIcons[p]} alt={p} className={cn('h-3.5 w-3.5', p !== 'gemini' && 'provider-icon-invert')} />
                        {p === 'gemini' ? 'Gemini' : 'OpenAI'}
                      </button>
                    ))}
                  </div>

                  <ModelSelector
                    apiKey={apiKey}
                    selectedModel={model}
                    onChange={setModel}
                    provider={provider}
                    dropdownDirection="down"
                  />

                  <Button
                    variant="primary"
                    size="sm"
                    icon={Sparkles}
                    onClick={handleGenerate}
                    disabled={!credentialsReady || !model}
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
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)]" />
              Generating AI cross-run summary...
            </div>
          )}

          {aiSummary && <AISummaryCard summary={aiSummary} />}
        </div>
      )}

      {/* Recurring Issues */}
      {data.issues.length > 0 && (
        <div>
          <SectionHeader title="Recurring Issues" description="Issues grouped by area across multiple runs." />
          <div className="space-y-1">
            {data.issues.map((issue) => (
              <IssueRow key={issue.area} issue={issue} />
            ))}
          </div>
        </div>
      )}

      {/* Recurring Recommendations */}
      {data.recommendations.length > 0 && (
        <div>
          <SectionHeader title="Recurring Recommendations" description="Recommendations grouped by area, sorted by priority." />
          <div className="space-y-1">
            {data.recommendations.map((rec) => (
              <RecommendationRow key={rec.area} rec={rec} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Issue Row (expandable) ──

function IssueRow({ issue }: { issue: Props['data']['issues'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const priority = rankToPriority(issue.worstRank);
  const dotColor = PRIORITY_DOT_COLORS[priority] || '#6b7280';

  return (
    <div className="border border-[var(--border-subtle)] rounded bg-[var(--bg-primary)]">
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />}
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">{issue.area}</span>
        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{issue.runCount} runs</span>
        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{issue.totalAffected} threads</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pl-10 space-y-1">
          {issue.descriptions.map((desc, i) => (
            <p key={i} className="text-xs text-[var(--text-secondary)]">
              {desc}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recommendation Row (expandable) ──

function RecommendationRow({ rec }: { rec: Props['data']['recommendations'][0] }) {
  const [expanded, setExpanded] = useState(false);
  const ps = PRIORITY_STYLES[rec.highestPriority] || PRIORITY_STYLES.P2;

  return (
    <div className="border border-[var(--border-subtle)] rounded bg-[var(--bg-primary)]">
      <button
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />}
        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', ps.bg, ps.border, ps.text)}>
          {rec.highestPriority}
        </span>
        <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">{rec.area}</span>
        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{rec.runCount} runs</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pl-10 space-y-1.5">
          {rec.actions.map((action, i) => (
            <p key={i} className="text-xs text-[var(--text-secondary)]">{action}</p>
          ))}
          {rec.estimatedImpacts.length > 0 && (
            <div className="pt-1 border-t border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase mb-0.5">Estimated Impacts</p>
              {rec.estimatedImpacts.map((impact, i) => (
                <p key={i} className="text-xs text-[var(--text-secondary)]">{impact}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI Summary Card ──

function AISummaryCard({ summary }: { summary: CrossRunAISummary }) {
  return (
    <div className="border border-[var(--border-default)] rounded-lg bg-[var(--bg-secondary)] p-4 space-y-4 mt-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-brand)] uppercase tracking-wider">
        <Sparkles className="h-3.5 w-3.5" />
        AI Cross-Run Summary
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Executive Summary</h4>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{summary.executiveSummary}</p>
        </div>

        <div>
          <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Trend Analysis</h4>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{summary.trendAnalysis}</p>
        </div>

        {summary.criticalPatterns.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Critical Patterns</h4>
            <ul className="list-disc list-inside space-y-0.5">
              {summary.criticalPatterns.map((p, i) => (
                <li key={i} className="text-xs text-[var(--text-secondary)]">{p}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.strategicRecommendations.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-[var(--text-primary)] mb-1">Strategic Recommendations</h4>
            <ol className="list-decimal list-inside space-y-0.5">
              {summary.strategicRecommendations.map((r, i) => (
                <li key={i} className="text-xs text-[var(--text-secondary)]">{r}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
