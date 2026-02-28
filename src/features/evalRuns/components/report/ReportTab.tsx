import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, RefreshCw, Download, FileBarChart, Sparkles, X } from 'lucide-react';
import type { ReportPayload } from '@/types/reports';
import type { LLMProvider } from '@/types';
import { reportsApi } from '@/services/api/reportsApi';
import { notificationService } from '@/services/notifications';
import { EmptyState, Button, Tabs } from '@/components/ui';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { useLLMSettingsStore, hasLLMCredentials } from '@/stores';
import { providerIcons } from '@/components/ui/ModelBadge/providers';
import { cn } from '@/utils';
import ExecutiveSummary from './ExecutiveSummary';
import VerdictDistributions from './VerdictDistributions';
import RuleComplianceTable from './RuleComplianceTable';
import FrictionAnalysis from './FrictionAnalysis';
import AdversarialBreakdown from './AdversarialBreakdown';
import ExemplarThreads from './ExemplarThreads';
import PromptGapAnalysis from './PromptGapAnalysis';
import Recommendations, { RecommendationsTable } from './Recommendations';
import SectionRail from './SectionRail';
import { METRIC_COLOR, PRIORITY_DOT_COLORS, rankToPriority } from './shared/colors';
import './report-print.css';

interface Props {
  runId: string;
}

type Status = 'loading' | 'idle' | 'generating' | 'ready' | 'error';

export default function ReportTab({ runId }: Props) {
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRefreshSelector, setShowRefreshSelector] = useState(false);
  const refreshPopoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showRefreshSelector) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (refreshPopoverRef.current && !refreshPopoverRef.current.contains(e.target as Node)) {
        setShowRefreshSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showRefreshSelector]);

  // Model selection for narrative generation
  const [reportProvider, setReportProvider] = useState<LLMProvider>('gemini');
  const [reportModel, setReportModel] = useState('');
  const credentialsReady = useLLMSettingsStore(hasLLMCredentials);
  const apiKey = useLLMSettingsStore((s) => s.apiKey);

  // On mount: pre-fill model selector + check for cached report
  useEffect(() => {
    const s = useLLMSettingsStore.getState();
    setReportProvider(s.provider);
    setReportModel(s.selectedModel);

    let cancelled = false;
    reportsApi.fetchReport(runId, { cacheOnly: true }).then((data) => {
      if (!cancelled) {
        setReport(data);
        setStatus('ready');
      }
    }).catch(() => {
      if (!cancelled) setStatus('idle');
    });
    return () => { cancelled = true; };
  }, [runId]);

  const fetchReport = useCallback(async (refresh = false) => {
    // First load vs refresh: different UI treatment
    if (report && refresh) {
      setRefreshing(true);
    } else {
      setStatus('generating');
    }
    setError(null);

    try {
      const data = await reportsApi.fetchReport(runId, {
        refresh: refresh || undefined,
        provider: reportProvider,
        model: reportModel || undefined,
      });
      setReport(data);
      setStatus('ready');
      if (refresh) notificationService.success('Report regenerated');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to generate report';
      setError(msg);
      // Only go to error state if we have nothing to show
      if (!report) setStatus('error');
      else notificationService.error(msg);
    } finally {
      setRefreshing(false);
    }
  }, [runId, report, reportProvider, reportModel]);

  const handleExportPdf = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await reportsApi.exportPdf(runId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eval-report-${runId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notificationService.success('PDF exported');
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }, [runId, exporting]);

  // ── Shared in-progress card (matches RunDetail eval-in-progress pattern) ──
  const inProgressCard = (label: string) => (
    <div className="flex flex-col items-center gap-2 border border-dashed border-[var(--border-default)] rounded-lg py-10 px-6">
      <Loader2 className="h-6 w-6 text-[var(--color-info)] animate-spin" />
      <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
      <p className="text-sm text-[var(--text-secondary)]">
        Aggregating evaluation data and generating AI narrative. This typically takes 10–30 seconds.
      </p>
    </div>
  );

  // ── Loading: checking for cached report ──
  if (status === 'loading') {
    return (
      <div className="min-h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 text-[var(--text-muted)] animate-spin" />
      </div>
    );
  }

  // ── Idle: no report generated yet ──
  if (status === 'idle') {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="max-w-[500px] w-full px-4">
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 space-y-5">
            {/* Header */}
            <div className="text-center space-y-1.5">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-brand-accent)]/10 mb-1">
                <FileBarChart className="h-5 w-5 text-[var(--text-brand)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Evaluation Report</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Generate an aggregate report with health scores, verdict distributions, rule compliance, exemplar threads, and AI-powered recommendations.
              </p>
            </div>

            {/* Model selector */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" />
                Narrative Model
              </div>

              {/* Provider toggle */}
              <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                {(['gemini', 'openai'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setReportProvider(p);
                      setReportModel('');
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                      reportProvider === p
                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    <img src={providerIcons[p]} alt={p} className={cn('h-3.5 w-3.5', p === 'openai' && 'provider-icon-openai')} />
                    {p === 'gemini' ? 'Gemini' : 'OpenAI'}
                  </button>
                ))}
              </div>

              {/* Model dropdown */}
              <ModelSelector
                apiKey={apiKey}
                selectedModel={reportModel}
                onChange={setReportModel}
                provider={reportProvider}
                dropdownDirection="down"
              />
            </div>

            {/* Generate button */}
            <Button
              variant="primary"
              size="lg"
              icon={FileBarChart}
              onClick={() => fetchReport()}
              disabled={!credentialsReady || !reportModel}
              className="w-full"
            >
              Generate Report
            </Button>

            {!credentialsReady && (
              <p className="text-xs text-center text-[var(--color-warning)]">
                Configure LLM credentials in Settings to generate reports.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Generating: first-time load ──
  if (status === 'generating' && !report) {
    return (
      <div className="max-w-[900px] mx-auto pt-8 px-4">
        {inProgressCard('Generating report...')}
      </div>
    );
  }

  // ── Error: no report to show ──
  if (status === 'error' && !report) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="max-w-[900px] w-full px-4">
          <EmptyState
            icon={FileBarChart}
            title="Report generation failed"
            description={error ?? 'Something went wrong. Try again.'}
            action={{
              label: 'Retry',
              onClick: () => fetchReport(),
            }}
          />
        </div>
      </div>
    );
  }

  if (!report) return null;

  // ── Shorthand ──
  const { healthScore, narrative, metadata } = report;
  const isAdversarial = metadata.evalType === 'batch_adversarial';
  const summaryMetrics = isAdversarial
    ? [
        { label: 'Pass Rate', item: healthScore.breakdown.intentAccuracy },
        { label: 'Goal Achievement', item: healthScore.breakdown.correctnessRate },
        { label: 'Rule Compliance', item: healthScore.breakdown.efficiencyRate },
        { label: 'Difficulty Score', item: healthScore.breakdown.taskCompletion },
      ]
    : [
        { label: 'Intent', item: healthScore.breakdown.intentAccuracy },
        { label: 'Correctness', item: healthScore.breakdown.correctnessRate },
        { label: 'Efficiency', item: healthScore.breakdown.efficiencyRate },
        { label: 'Task Completion', item: healthScore.breakdown.taskCompletion },
      ];
  const threadLabel = isAdversarial ? 'tests' : 'threads';

  const formattedDate = new Date(metadata.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  // ── Report loaded ──
  return (
    <div className="relative">
      {/* ── Print-only cover page ── */}
      <div className="print-cover hidden">
        <div
          style={{
            background: '#0f172a',
            color: '#fff',
            padding: '20mm 14mm 12mm',
            marginBottom: '6mm',
            borderRadius: '8px',
          }}
        >
          <div
            style={{
              fontSize: '8px',
              background: '#38bdf8',
              color: '#0f172a',
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: '10px',
              marginBottom: '8px',
              fontWeight: 700,
              letterSpacing: '0.5px',
            }}
          >
            AI EVALS PLATFORM
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '4px 0' }}>
            {metadata.runName || metadata.appId || 'Evaluation Report'}
          </h1>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0' }}>
            {metadata.evalType} &middot; {metadata.completedThreads} {threadLabel} &middot; {formattedDate}
          </p>
          {metadata.llmModel && (
            <p style={{ fontSize: '9px', color: '#64748b', marginTop: '6px' }}>
              Model: {metadata.llmModel}
            </p>
          )}
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: gradeHex(healthScore.grade),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>
                {healthScore.grade}
              </span>
            </div>
            <div>
              <span style={{ fontSize: '28px', fontWeight: 'bold' }}>
                {Math.round(healthScore.numeric)}
              </span>
              <span style={{ fontSize: '14px', color: '#94a3b8', marginLeft: '4px' }}>/ 100</span>
            </div>
          </div>
        </div>

        {/* Health breakdown cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '6mm' }}>
          {summaryMetrics.map(({ label, item }) => (
            <div
              key={label}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '8px 10px',
                borderTop: `3px solid ${METRIC_COLOR(item.value)}`,
              }}
            >
              <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 4px' }}>
                {label}
              </p>
              <p style={{ fontSize: '18px', fontWeight: 'bold', color: METRIC_COLOR(item.value), margin: 0 }}>
                {Math.round(item.value)}%
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="report-container max-w-[900px] mx-auto pb-8">
        {/* Compact header */}
        <div className="report-actions flex items-center gap-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-2 mb-4">
          {/* Grade circle */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm"
            style={{ backgroundColor: gradeHex(healthScore.grade) }}
          >
            <span className="text-white text-sm font-bold">{healthScore.grade}</span>
          </div>
          {/* Score */}
          <div className="h-10 flex items-center">
            <span className="text-xl font-bold text-[var(--text-primary)] leading-none">
              {Math.round(healthScore.numeric)}
            </span>
            <span className="text-sm text-[var(--text-muted)] ml-1.5 leading-none">/ 100</span>
          </div>
          {/* Metadata */}
          <div className="h-10 flex items-center text-xs text-[var(--text-muted)] flex-wrap gap-x-1.5 gap-y-0.5">
            <span>{metadata.completedThreads} {threadLabel}</span>
            <span>&middot;</span>
            <span>{metadata.evalType}</span>
            {metadata.llmModel && (
              <>
                <span>&middot;</span>
                <span>{metadata.llmModel}</span>
              </>
            )}
            <span>&middot;</span>
            <span>{formattedDate}</span>
          </div>
          {/* Spacer */}
          <div className="flex-1" />
          {/* Action buttons */}
          <div className="h-10 flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportPdf}
              disabled={refreshing || exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--interactive-primary)] rounded-md hover:opacity-90 transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {exporting ? 'Exporting...' : 'Export PDF'}
            </button>
            <div className="relative" ref={refreshPopoverRef}>
              <button
                onClick={() => setShowRefreshSelector((v) => !v)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-default)] rounded-md hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
                title="Regenerate report (bypasses cache)"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              {/* Model selection popover */}
              {showRefreshSelector && (
                <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg z-20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                      <Sparkles className="h-3 w-3" />
                      Narrative Model
                    </div>
                    <button
                      onClick={() => setShowRefreshSelector(false)}
                      className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Provider toggle */}
                  <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                    {(['gemini', 'openai'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setReportProvider(p);
                          setReportModel('');
                        }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                          reportProvider === p
                            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                        }`}
                      >
                        <img src={providerIcons[p]} alt={p} className={cn('h-3.5 w-3.5', p === 'openai' && 'provider-icon-openai')} />
                        {p === 'gemini' ? 'Gemini' : 'OpenAI'}
                      </button>
                    ))}
                  </div>

                  {/* Model dropdown */}
                  <ModelSelector
                    apiKey={apiKey}
                    selectedModel={reportModel}
                    onChange={setReportModel}
                    provider={reportProvider}
                    dropdownDirection="down"
                  />

                  {/* Regenerate button */}
                  <button
                    onClick={() => {
                      setShowRefreshSelector(false);
                      fetchReport(true);
                    }}
                    disabled={!credentialsReady || !reportModel}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[var(--interactive-primary)] rounded-md hover:opacity-90 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate Report
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* In-progress card replaces tabs during regeneration */}
        {refreshing && inProgressCard('Regenerating report...')}

        {/* Two-tab layout */}
        {!refreshing && <Tabs
          className="report-tabs"
          tabs={[
            {
              id: 'summary',
              label: 'Summary',
              content: (
                <div className="space-y-6 pt-2">
                  {/* Compact inline metric row */}
                  <div className="flex flex-wrap items-center gap-6 py-3">
                    {summaryMetrics.map(({ label, item }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)]">{label}</span>
                        <span
                          className="text-sm font-bold"
                          style={{ color: METRIC_COLOR(item.value) }}
                        >
                          {Math.round(item.value)}%
                        </span>
                        <div className="w-12 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${item.value}%`,
                              backgroundColor: METRIC_COLOR(item.value),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Executive summary prose */}
                  {narrative?.executiveSummary ? (
                    <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-3">
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                        {narrative.executiveSummary}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-muted)] italic">
                      AI narrative was not generated for this report.
                    </p>
                  )}

                  {/* Top Issues */}
                  {narrative?.topIssues && narrative.topIssues.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Top Issues</h3>
                      <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b-2 border-[var(--border-subtle)]">
                              <th style={{ width: 12 }} className="px-2 py-1.5" />
                              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Issue</th>
                              <th className="text-left px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Focus Area</th>
                              <th className="text-right px-2 py-1.5 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{isAdversarial ? 'Tests Affected' : 'Threads Affected'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {narrative.topIssues.map((issue, i) => {
                              const priority = rankToPriority(issue.rank);
                              return (
                                <tr key={issue.rank} className={i % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}>
                                  <td className="px-2 py-2 align-top">
                                    <span
                                      className="inline-block w-2 h-2 rounded-full"
                                      style={{ backgroundColor: PRIORITY_DOT_COLORS[priority] }}
                                    />
                                  </td>
                                  <td className="px-2 py-2 align-top font-semibold text-[var(--text-primary)]">{issue.description}</td>
                                  <td className="px-2 py-2 align-top whitespace-nowrap text-[var(--text-muted)]">{issue.area}</td>
                                  <td className="px-2 py-2 align-top text-right text-[var(--text-muted)] whitespace-nowrap">{issue.affectedCount}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Top 3 Recommendations */}
                  {narrative?.recommendations && narrative.recommendations.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Top Recommendations</h3>
                      <RecommendationsTable items={narrative.recommendations.slice(0, 3)} />
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: 'detailed',
              label: 'Detailed Analysis',
              content: (
                <div className="report-detailed-sections space-y-8 pt-2">
                  <SectionRail pageKey="detailed" />
                  <ExecutiveSummary healthScore={report.healthScore} narrative={report.narrative} isAdversarial={isAdversarial} />
                  <VerdictDistributions distributions={report.distributions} isAdversarial={isAdversarial} adversarialBreakdown={report.adversarial} />
                  <RuleComplianceTable ruleCompliance={report.ruleCompliance} />
                  {!isAdversarial && <FrictionAnalysis friction={report.friction} />}
                  {(isAdversarial || report.adversarial) && report.adversarial && (
                    <AdversarialBreakdown adversarial={report.adversarial} />
                  )}
                  <ExemplarThreads exemplars={report.exemplars} narrative={report.narrative} isAdversarial={isAdversarial} />
                  <PromptGapAnalysis narrative={report.narrative} />
                  <Recommendations narrative={report.narrative} />
                </div>
              ),
            },
          ]}
          defaultTab="summary"
        />}
      </div>

      {/* Print-only footer */}
      <div className="print-footer print-only hidden">
        CONFIDENTIAL &mdash; AI Evals Platform &middot; Tatvacare
      </div>
    </div>
  );
}

function gradeHex(grade: string): string {
  if (grade.startsWith('A')) return '#10b981';
  if (grade.startsWith('B')) return '#10b981';
  if (grade.startsWith('C')) return '#f59e0b';
  if (grade.startsWith('D')) return '#ef4444';
  return '#ef4444';
}
