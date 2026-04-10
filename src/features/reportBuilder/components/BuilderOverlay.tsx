import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, Send, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button, LLMConfigSection } from '@/components/ui';
import { sendBuilderMessage } from '../api';
import { cn } from '@/utils/cn';
import type { AppId, LLMProvider } from '@/types';
import type { BuilderMessage, ComposedReport } from '../types';
import type { PlatformRunReportPayload, PlatformReportSection } from '@/types/platformReports';
import { LLM_PROVIDERS, hasProviderCredentials, useLLMSettingsStore } from '@/stores';
import SectionHeader from '@/features/evalRuns/components/report/shared/SectionHeader';
import {
  transformDistributions,
  transformAdversarialBreakdown,
  transformCompliance,
  transformExemplars,
  transformNarrative,
} from '@/features/evalRuns/components/report/sectionTransforms';
import VerdictDistributions from '@/features/evalRuns/components/report/VerdictDistributions';
import RuleComplianceTable from '@/features/evalRuns/components/report/RuleComplianceTable';
import ExemplarThreads from '@/features/evalRuns/components/report/ExemplarThreads';
import FrictionAnalysis from '@/features/evalRuns/components/report/FrictionAnalysis';
import PromptGapAnalysis from '@/features/evalRuns/components/report/PromptGapAnalysis';
import Recommendations from '@/features/evalRuns/components/report/Recommendations';

interface Props {
  appId: AppId;
  open: boolean;
  onClose: () => void;
  /** The current report payload — used to render real components with real data. */
  reportPayload?: PlatformRunReportPayload | null;
}

/**
 * Mini render surface: takes a composed config + the full report payload,
 * filters sections to match the config, renders actual components.
 */
function MiniReportPreview({
  composed,
  payload,
}: {
  composed: ComposedReport;
  payload: PlatformRunReportPayload | null | undefined;
}) {
  if (!payload || payload.sections.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
          {composed.reportName}
        </div>
        <div className="text-xs text-[var(--text-muted)] italic">
          No report data available. Generate a report first to see live preview.
        </div>
      </div>
    );
  }

  const sectionMap = useMemo(
    () => new Map(payload.sections.map((s) => [s.type as string, s])),
    [payload.sections],
  );

  const matchedSections = composed.sections
    .map((cs) => sectionMap.get(cs.type))
    .filter((s): s is PlatformReportSection => s != null);

  if (matchedSections.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
          {composed.reportName}
        </div>
        {composed.sections.map((s) => (
          <div key={s.id} className="text-xs text-[var(--text-secondary)] py-0.5">
            {s.title} <span className="text-[var(--text-muted)]">({s.type})</span>
          </div>
        ))}
        <div className="mt-2 text-xs text-[var(--text-muted)] italic">
          Data for these section types is not in the current report. Sections will render when a matching report is generated.
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 space-y-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        Live Preview — {composed.reportName}
      </div>
      {matchedSections.map((section) => (
        <div key={section.id} className="space-y-2">
          <SectionHeader title={section.title} />
          <InlineSectionRenderer section={section} report={payload} />
        </div>
      ))}
    </div>
  );
}

/**
 * Renders a single section using the same rich components as PlatformReportView.
 * Imports the transforms and components directly — no lazy loading needed
 * since these are already bundled.
 */
function InlineSectionRenderer({
  section,
  report,
}: {
  section: PlatformReportSection;
  report: PlatformRunReportPayload;
}) {
  const type = section.type;

  // Distribution chart → VerdictDistributions
  if (type === 'distribution_chart') {
    const distSection = section as Extract<PlatformReportSection, { type: 'distribution_chart' }>;
    return (
      <VerdictDistributions
        distributions={transformDistributions(distSection)}
        isAdversarial={report.metadata.evalType === 'batch_adversarial'}
        adversarialBreakdown={transformAdversarialBreakdown(distSection)}
      />
    );
  }

  // Compliance table → RuleComplianceTable
  if (type === 'compliance_table') {
    return <RuleComplianceTable ruleCompliance={transformCompliance(section as any)} />;
  }

  // Exemplars → ExemplarThreads
  if (type === 'exemplars') {
    return (
      <ExemplarThreads
        exemplars={transformExemplars(section as any)}
        narrative={transformNarrative(report)}
        isAdversarial={report.metadata.evalType === 'batch_adversarial'}
        runId={report.metadata.runId}
      />
    );
  }

  // Friction analysis → FrictionAnalysis
  if (type === 'friction_analysis') {
    return <FrictionAnalysis friction={(section as any).data} runId={report.metadata.runId} />;
  }

  // Prompt gap analysis → PromptGapAnalysis
  if (type === 'prompt_gap_analysis') {
    return <PromptGapAnalysis narrative={transformNarrative(report)} />;
  }

  // Issues & recommendations → Recommendations
  if (type === 'issues_recommendations') {
    return <Recommendations narrative={transformNarrative(report)} />;
  }

  // Metric breakdown → inline bars
  if (type === 'metric_breakdown') {
    const metricSection = section as Extract<PlatformReportSection, { type: 'metric_breakdown' }>;
    return (
      <div className="grid gap-2 grid-cols-2">
        {metricSection.data.map((m) => {
          const pct = m.maxValue > 0 ? Math.round((m.value / m.maxValue) * 100) : 0;
          const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning)' : 'var(--color-error)';
          return (
            <div key={m.key}>
              <div className="text-[10px] text-[var(--text-muted)]">{m.label}</div>
              <div className="text-sm font-bold" style={{ color }}>{pct}%</div>
              <div className="h-1 rounded-full bg-[var(--bg-tertiary)] mt-1">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Flags → simple table
  if (type === 'flags') {
    const flagsSection = section as Extract<PlatformReportSection, { type: 'flags' }>;
    return (
      <div className="text-xs space-y-1">
        {flagsSection.data.map((f) => (
          <div key={f.key} className="flex justify-between">
            <span className="text-[var(--text-secondary)]">{f.label}</span>
            <span className="text-[var(--text-primary)]">{f.present}/{f.relevant}</span>
          </div>
        ))}
      </div>
    );
  }

  // Entity slices → compact list
  if (type === 'entity_slices') {
    const entitySection = section as Extract<PlatformReportSection, { type: 'entity_slices' }>;
    return (
      <div className="text-xs space-y-2">
        {entitySection.data.slice(0, 4).map((e) => (
          <div key={e.entityId} className="flex justify-between border-b border-[var(--border-subtle)] pb-1">
            <span className="font-medium text-[var(--text-primary)]">{e.label}</span>
            <span className="text-[var(--text-muted)]">
              {Object.entries(e.summary).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Fallback
  return (
    <div className="text-xs text-[var(--text-muted)] italic">
      {section.type} section — preview not available in builder
    </div>
  );
}

export function BuilderOverlay({ appId, open, onClose, reportPayload }: Props) {
  const [messages, setMessages] = useState<BuilderMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [provider, setProvider] = useState<LLMProvider>(LLM_PROVIDERS[0].value);
  const [model, setModel] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const geminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const openaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const azureApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const azureEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const anthropicApiKey = useLLMSettingsStore((s) => s.anthropicApiKey);
  const saConfigured = useLLMSettingsStore((s) => s._serviceAccountConfigured);

  const credentialsReady = hasProviderCredentials(provider, {
    geminiApiKey,
    openaiApiKey,
    azureOpenaiApiKey: azureApiKey,
    azureOpenaiEndpoint: azureEndpoint,
    anthropicApiKey,
    _serviceAccountConfigured: saConfigured,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !model) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const response = await sendBuilderMessage({
        appId,
        sessionId,
        message: text,
        provider,
        model,
      });

      setSessionId(response.sessionId);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: response.content,
        composedReport: response.composedReport,
      }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Request failed'}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [appId, input, loading, model, provider, sessionId]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-[var(--z-overlay)] flex w-[520px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--color-brand-accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Build Your Own Report</h3>
        </div>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* LLM Picker */}
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <LLMConfigSection
          provider={provider}
          onProviderChange={(v) => { setProvider(v); setModel(''); }}
          model={model}
          onModelChange={setModel}
          compact
        />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Sparkles className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3" />
            <p className="text-sm text-[var(--text-muted)]">
              Tell me what you want to see in your report. I'll assemble it from available components and show you a live preview.
            </p>
            <div className="mt-4 space-y-1 text-xs text-[var(--text-muted)]">
              <p>"Show me agent performance and compliance gaps"</p>
              <p>"I want friction patterns and the worst examples"</p>
              <p>"Build a compact report with just metrics and recommendations"</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'ml-8 bg-[var(--color-brand-accent)]/15 text-[var(--text-primary)]'
                  : 'mr-2 bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
              )}
            >
              <div className="prose prose-sm prose-invert max-w-none [&_p]:mb-1 [&_ul]:mb-1 [&_li]:mb-0">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
            {msg.composedReport && (
              <MiniReportPreview composed={msg.composedReport} payload={reportPayload} />
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Building...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border-default)] px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={model ? 'Describe your report...' : 'Select a model first'}
            disabled={!model || !credentialsReady}
            className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
          />
          <Button
            variant="primary"
            size="sm"
            icon={Send}
            onClick={() => void send()}
            disabled={!input.trim() || loading || !model || !credentialsReady}
          />
        </div>
      </div>
    </div>
  );
}
