import { type ReactNode, useMemo, useState } from 'react';
import { Tabs } from '@/components/ui';
import type {
  CalloutSection,
  ComplianceTableSection,
  DistributionChartSection,
  ExemplarsSection,
  FrictionAnalysisSection,
  IssuesRecommendationsSection,
  MetricBreakdownSection,
  NarrativeSection,
  PlatformRunNarrative,
  PlatformRunReportPayload,
  PromptGapAnalysisSection,
  SummaryCard,
  SummaryCardsSection,
} from '@/types/platformReports';
import type {
  AdversarialBreakdown,
  ExemplarAnalysis,
  ExemplarThread,
  Exemplars,
  NarrativeOutput,
  PromptGap,
  RuleComplianceMatrix,
  VerdictDistributions as LegacyVerdictDistributions,
} from '@/types/reports';
import VerdictDistributions from './VerdictDistributions';
import FrictionAnalysis from './FrictionAnalysis';
import RuleComplianceTable from './RuleComplianceTable';
import ExemplarThreads from './ExemplarThreads';
import PromptGapAnalysis from './PromptGapAnalysis';
import SectionRail from './SectionRail';
import SectionHeader from './shared/SectionHeader';
import CalloutBox from './shared/CalloutBox';
import { METRIC_COLOR, PRIORITY_DOT_COLORS, PRIORITY_STYLES } from './shared/colors';
import './report-print.css';

type PriorityKey = 'P0' | 'P1' | 'P2';

interface Props {
  report: PlatformRunReportPayload;
  runId: string;
  actions?: ReactNode;
}

interface KairaIssueRow {
  title: string;
  area: string;
  summary: string;
  priority: PriorityKey;
}

interface KairaRecommendationRow {
  title: string;
  area: string;
  action: string;
  priority: PriorityKey;
  rationale: string | null;
}

function gradeHex(grade: string): string {
  if (grade.startsWith('A') || grade.startsWith('B')) return '#10b981';
  if (grade.startsWith('C')) return '#f59e0b';
  return '#ef4444';
}

function parseNumeric(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePriority(value: string | null | undefined, fallbackIndex = 0): PriorityKey {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'P0' || normalized === 'CRITICAL' || normalized === 'HIGH') return 'P0';
  if (normalized === 'P1' || normalized === 'MEDIUM') return 'P1';
  if (normalized === 'P2' || normalized === 'LOW') return 'P2';
  return fallbackIndex === 0 ? 'P0' : fallbackIndex < 3 ? 'P1' : 'P2';
}

function getSectionByVariant<TType extends PlatformRunReportPayload['sections'][number]['type']>(
  report: PlatformRunReportPayload,
  variant: string,
  type: TType,
): Extract<PlatformRunReportPayload['sections'][number], { type: TType }> | null {
  const section = report.sections.find((candidate) => candidate.variant === variant && candidate.type === type);
  return (section as Extract<PlatformRunReportPayload['sections'][number], { type: TType }> | undefined) ?? null;
}

function getSectionByType<TType extends PlatformRunReportPayload['sections'][number]['type']>(
  report: PlatformRunReportPayload,
  type: TType,
): Extract<PlatformRunReportPayload['sections'][number], { type: TType }> | null {
  const section = report.sections.find((candidate) => candidate.type === type);
  return (section as Extract<PlatformRunReportPayload['sections'][number], { type: TType }> | undefined) ?? null;
}

function summaryCardMap(section: SummaryCardsSection | null): Map<string, SummaryCard> {
  return new Map((section?.data ?? []).map((card) => [card.key, card]));
}

function firstCard(cards: Map<string, SummaryCard>, keys: string[]): SummaryCard | null {
  for (const key of keys) {
    const card = cards.get(key);
    if (card) return card;
  }

  return cards.values().next().value ?? null;
}

function buildSummaryMetrics(metrics: MetricBreakdownSection | null, isAdversarial: boolean) {
  const labels: Record<string, string> = isAdversarial
    ? {
        'intent-accuracy': 'Pass Rate',
        'correctness-rate': 'Goal Achievement',
        'efficiency-rate': 'Rule Compliance',
        'task-completion': 'Difficulty Score',
      }
    : {
        'intent-accuracy': 'Intent',
        'correctness-rate': 'Correctness',
        'efficiency-rate': 'Efficiency',
        'task-completion': 'Task Completion',
      };

  return (metrics?.data ?? []).map((item) => ({
    key: item.key,
    label: labels[item.key] ?? item.label,
    value: item.value,
  }));
}

function distributionSeriesKey(series: DistributionChartSection['data'][number]): string {
  return ((series as { key?: string }).key ?? series.label).toLowerCase();
}

function buildVerdictDistributions(section: DistributionChartSection | null): LegacyVerdictDistributions {
  const distributions: LegacyVerdictDistributions = {
    correctness: {},
    efficiency: {},
    adversarial: null,
    intentHistogram: { buckets: [], counts: [] },
  };

  for (const series of section?.data ?? []) {
    const key = distributionSeriesKey(series);
    const values = Object.fromEntries(series.categories.map((category, index) => [category, series.values[index] ?? 0]));

    if (key === 'correctness') {
      distributions.correctness = values;
      continue;
    }

    if (key === 'efficiency') {
      distributions.efficiency = values;
      continue;
    }

    if (key === 'adversarial') {
      distributions.adversarial = values;
      continue;
    }

    if (key === 'intent' || key === 'intent-histogram') {
      distributions.intentHistogram = {
        buckets: [...series.categories],
        counts: [...series.values],
      };
    }
  }

  return distributions;
}

function buildAdversarialBreakdown(section: DistributionChartSection | null): AdversarialBreakdown | null {
  const byGoal = (section?.data ?? [])
    .filter((series) => distributionSeriesKey(series).startsWith('goal:') && series.values.length > 0)
    .map((series) => {
      const passRate = series.values[0] ?? 0;
      const total = 100;
      return {
        goal: series.label,
        passed: Math.round((passRate / 100) * total),
        total,
        passRate: passRate / 100,
      };
    });

  const byDifficulty = (section?.data ?? [])
    .filter((series) => distributionSeriesKey(series).startsWith('difficulty:') && series.values.length > 0)
    .map((series) => {
      const passed = Math.round(series.values[0] ?? 0);
      const failed = Math.round(series.values[1] ?? 0);
      return {
        difficulty: series.label,
        passed,
        total: passed + failed,
      };
    });

  if (byGoal.length === 0 && byDifficulty.length === 0) return null;

  return {
    byGoal,
    byDifficulty,
  };
}

function buildRuleCompliance(section: ComplianceTableSection | null): RuleComplianceMatrix {
  return {
    rules: (section?.data ?? []).map((row) => ({
      ruleId: row.label || row.key,
      section: row.section || row.label || row.key,
      passed: row.passed,
      failed: row.failed,
      rate: row.rate > 1 ? row.rate / 100 : row.rate,
      severity: (row.severity?.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined) ?? 'LOW',
    })),
    coFailures: [],
  };
}

function splitAnalysis(text: string): Pick<ExemplarAnalysis, 'whatHappened' | 'why'> {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      whatHappened: parts[0],
      why: parts.slice(1).join(' '),
    };
  }

  return {
    whatHappened: text,
    why: text,
  };
}

function parseSummaryField(summary: string, field: string): string | null {
  const match = summary.match(new RegExp(`${field}=([^,]+)`));
  return match?.[1]?.trim() ?? null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readTranscript(value: unknown): ExemplarThread['transcript'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const role = readString((item as Record<string, unknown>).role);
    const content = readString((item as Record<string, unknown>).content);
    return (role === 'user' || role === 'assistant') && content ? [{ role, content }] : [];
  });
}

function readRuleViolations(value: unknown): ExemplarThread['ruleViolations'] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((ruleId) => ({ ruleId, evidence: '' }));
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const ruleId = readString((item as Record<string, unknown>).ruleId);
    if (!ruleId) return [];
    return [{
      ruleId,
      evidence: readString((item as Record<string, unknown>).evidence) ?? '',
    }];
  });
}

function readFrictionTurns(value: unknown): ExemplarThread['frictionTurns'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const turn = readNumber((item as Record<string, unknown>).turn);
    const cause = readString((item as Record<string, unknown>).cause);
    const description = readString((item as Record<string, unknown>).description);
    return turn != null && cause && description ? [{ turn, cause: cause as 'bot' | 'user', description }] : [];
  });
}

function readStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === 'string' ? [item] : []));
}

function readTaskCompleted(details: Record<string, unknown>, summary: string): boolean {
  const explicit = readBoolean(details.taskCompleted);
  if (explicit != null) return explicit;

  const fallback = parseSummaryField(summary, 'Task completed');
  return fallback === 'True' || fallback === 'true';
}

function buildExemplars(section: ExemplarsSection | null): Exemplars {
  const exemplars: Exemplars = { best: [], worst: [] };

  for (const item of section?.data ?? []) {
    const details = item.details ?? {};
    const bucket = details.type === 'worst' ? 'worst' : 'best';

    const thread: ExemplarThread = {
      threadId: item.itemId,
      compositeScore: item.score ?? 0,
      intentAccuracy: readNumber(details.intentAccuracy),
      correctnessVerdict: readString(details.correctnessVerdict) ?? parseSummaryField(item.summary, 'Correctness'),
      efficiencyVerdict: readString(details.efficiencyVerdict) ?? parseSummaryField(item.summary, 'Efficiency'),
      taskCompleted: readTaskCompleted(details, item.summary),
      transcript: readTranscript(details.transcript),
      ruleViolations: readRuleViolations(details.ruleViolations),
      frictionTurns: readFrictionTurns(details.frictionTurns),
      goalFlow: readStringList(details.goalFlow),
      activeTraits: readStringList(details.activeTraits),
      difficulty: readString(details.difficulty) ?? undefined,
      failureModes: readStringList(details.failureModes),
      reasoning: readString(details.reasoning) ?? undefined,
      goalAchieved: readBoolean(details.goalAchieved) ?? undefined,
    };

    exemplars[bucket].push(thread);
  }

  return exemplars;
}

function buildNarrative(
  narrativeSection: NarrativeSection | null,
  recommendationsSection: IssuesRecommendationsSection | null,
  promptGapSection: PromptGapAnalysisSection | null,
): NarrativeOutput | null {
  const narrative = narrativeSection?.data as PlatformRunNarrative | undefined;

  if (!narrative && !recommendationsSection && !promptGapSection) {
    return null;
  }

  const issues = recommendationsSection?.data.issues ?? [];
  const recommendations = recommendationsSection?.data.recommendations ?? [];
  const exemplarAnalysis = (narrative?.exemplars ?? []).map((item) => {
    const split = splitAnalysis(item.analysis);
    return {
      threadId: item.itemId,
      type: item.label.toLowerCase().includes('worst') ? 'bad' : 'good',
      whatHappened: split.whatHappened,
      why: split.why,
      promptGap: null,
    } satisfies ExemplarAnalysis;
  });

  return {
    executiveSummary: narrative?.executiveSummary ?? '',
    topIssues: issues.map((item, index) => ({
      rank: index + 1,
      area: item.area,
      description: item.summary || item.title,
      affectedCount: 0,
      exampleThreadId: null,
    })),
    exemplarAnalysis,
    promptGaps: (promptGapSection?.data ?? narrative?.promptGaps ?? []).map((item) => ({
      promptSection: item.promptSection,
      evalRule: item.evaluationRule,
      gapType: item.gapType as PromptGap['gapType'],
      description: 'summary' in item ? item.summary : '',
      suggestedFix: item.suggestedFix ?? '',
    })),
    recommendations: recommendations.map((item) => ({
      priority: normalizePriority(item.priority),
      area: item.title || item.action,
      action: item.action,
      estimatedImpact: item.expectedImpact ?? '',
    })),
  };
}

function buildIssueRows(
  narrativeSection: NarrativeSection | null,
  recommendationsSection: IssuesRecommendationsSection | null,
): KairaIssueRow[] {
  if (recommendationsSection) {
    return recommendationsSection.data.issues.map((item, index) => ({
      title: item.title,
      area: item.area,
      summary: item.summary,
      priority: normalizePriority(item.priority, index),
    }));
  }

  const narrative = narrativeSection?.data as PlatformRunNarrative | undefined;
  return (narrative?.issues ?? []).map((item, index) => ({
    title: item.title,
    area: item.area,
    summary: item.summary,
    priority: normalizePriority(item.severity, index),
  }));
}

function buildRecommendationRows(
  narrativeSection: NarrativeSection | null,
  recommendationsSection: IssuesRecommendationsSection | null,
): KairaRecommendationRow[] {
  const narrative = narrativeSection?.data as PlatformRunNarrative | undefined;
  const narrativeByAction = new Map((narrative?.recommendations ?? []).map((item) => [item.action, item]));

  if (recommendationsSection) {
    return recommendationsSection.data.recommendations.map((item, index) => {
      const source = narrativeByAction.get(item.action);
      return {
        title: item.title,
        area: source?.area || item.title || item.action,
        action: item.action,
        priority: normalizePriority(item.priority, index),
        rationale: source?.rationale ?? item.expectedImpact ?? null,
      };
    });
  }

  return (narrative?.recommendations ?? []).map((item, index) => ({
    title: item.area || item.action,
    area: item.area,
    action: item.action,
    priority: normalizePriority(item.priority, index),
    rationale: item.rationale,
  }));
}

function IssuesTable({ issues, limit, emptyLabel }: { issues: KairaIssueRow[]; limit?: number; emptyLabel: string }) {
  const rows = typeof limit === 'number' ? issues.slice(0, limit) : issues;

  if (rows.length === 0) {
    return (
      <CalloutBox variant="info">
        {emptyLabel}
      </CalloutBox>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[var(--border-subtle)]">
            <th style={{ width: 12 }} className="px-2 py-1.5" />
            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Issue</th>
            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Focus Area</th>
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Priority</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((issue, index) => (
            <tr key={`${issue.title}-${issue.area}-${index}`} className={index % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}>
              <td className="px-2 py-2.5 align-top">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: PRIORITY_DOT_COLORS[issue.priority] }}
                />
              </td>
              <td className="px-2 py-2.5 align-top">
                <div className="font-medium text-[var(--text-primary)]">{issue.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{issue.summary}</div>
              </td>
              <td className="px-2 py-2.5 align-top whitespace-nowrap text-[var(--text-muted)]">{issue.area || 'General'}</td>
              <td className="px-2 py-2.5 align-top text-right">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[issue.priority].bg} ${PRIORITY_STYLES[issue.priority].border} ${PRIORITY_STYLES[issue.priority].text}`}>
                  {issue.priority}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationsTable({
  recommendations,
  limit,
  emptyLabel,
}: {
  recommendations: KairaRecommendationRow[];
  limit?: number;
  emptyLabel: string;
}) {
  const rows = typeof limit === 'number' ? recommendations.slice(0, limit) : recommendations;

  if (rows.length === 0) {
    return (
      <CalloutBox variant="info">
        {emptyLabel}
      </CalloutBox>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[var(--border-subtle)]">
            <th style={{ width: 12 }} className="px-2 py-1.5" />
            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Action</th>
            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Focus Area</th>
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Priority</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((recommendation, index) => (
            <tr key={`${recommendation.action}-${index}`} className={index % 2 === 0 ? 'bg-[var(--bg-primary)]' : 'bg-[var(--bg-secondary)]'}>
              <td className="px-2 py-2.5 align-top">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: PRIORITY_DOT_COLORS[recommendation.priority] }}
                />
              </td>
              <td className="px-2 py-2.5 align-top">
                <div className="font-medium text-[var(--text-primary)]">{recommendation.action}</div>
                {recommendation.rationale ? (
                  <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{recommendation.rationale}</div>
                ) : null}
              </td>
              <td className="px-2 py-2.5 align-top whitespace-nowrap text-[var(--text-muted)]">{recommendation.area || recommendation.title}</td>
              <td className="px-2 py-2.5 align-top text-right">
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[recommendation.priority].bg} ${PRIORITY_STYLES[recommendation.priority].border} ${PRIORITY_STYLES[recommendation.priority].text}`}>
                  {recommendation.priority}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KairaExecutiveSummarySection({
  narrative,
  summaryMetrics,
  issues,
  recommendations,
}: {
  narrative: NarrativeOutput | null;
  summaryMetrics: Array<{ key: string; label: string; value: number }>;
  issues: KairaIssueRow[];
  recommendations: KairaRecommendationRow[];
}) {
  return (
    <section className="report-section">
      <SectionHeader
        title="Executive Summary"
        description="High-signal narrative, top breakdown metrics, and prioritized actions for this run."
      />

      <div className="grid gap-3 md:grid-cols-4">
        {summaryMetrics.map((metric) => (
          <div
            key={metric.key}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
            style={{ borderTopWidth: '3px', borderTopColor: METRIC_COLOR(metric.value) }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{metric.label}</p>
            <p className="mt-2 text-xl font-bold" style={{ color: METRIC_COLOR(metric.value) }}>
              {Math.round(metric.value)}%
            </p>
          </div>
        ))}
      </div>

      {narrative?.executiveSummary ? (
        <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{narrative.executiveSummary}</p>
        </div>
      ) : (
        <CalloutBox variant="info" className="mt-4">
          AI narrative was not generated for this report.
        </CalloutBox>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top Issues</h3>
          <IssuesTable issues={issues} emptyLabel="No issue narratives are available for this run." />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recommendations</h3>
          <RecommendationsTable recommendations={recommendations} emptyLabel="No recommendations are available for this run." />
        </div>
      </div>
    </section>
  );
}

function KairaFrictionSection({
  friction,
  legacyCallout,
  runId,
}: {
  friction: FrictionAnalysisSection | null;
  legacyCallout: CalloutSection | null;
  runId: string;
}) {
  return (
    <section className="report-section">
      {friction ? (
        <FrictionAnalysis friction={friction.data} runId={runId} />
      ) : legacyCallout ? (
        <CalloutBox variant="warning">
          {legacyCallout.data.message}
        </CalloutBox>
      ) : (
        <CalloutBox variant="info">
          Friction analysis is not available for this run.
        </CalloutBox>
      )}
    </section>
  );
}

function KairaRecommendationsSection({ recommendations }: { recommendations: KairaRecommendationRow[] }) {
  return (
    <section className="report-section">
      <SectionHeader
        title="Recommendations"
        description="Priority-grouped actions adapted from the current report contract."
      />

      {recommendations.length === 0 ? (
        <CalloutBox variant="info">
          No recommendations are available for this run.
        </CalloutBox>
      ) : (
        <div className="space-y-6">
          {(['P0', 'P1', 'P2'] as const).map((priority) => {
            const group = recommendations.filter((item) => item.priority === priority);
            if (group.length === 0) return null;

            return (
              <div key={priority}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {PRIORITY_STYLES[priority].label}
                </h3>
                <div className="space-y-3">
                  {group.map((item, index) => (
                    <div
                      key={`${item.action}-${index}`}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: PRIORITY_DOT_COLORS[item.priority] }}
                        />
                        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{item.action}</h4>
                        <span className="text-xs text-[var(--text-muted)]">{item.area || item.title}</span>
                      </div>
                      {item.rationale ? (
                        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{item.rationale}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function KairaReportView({ report, runId, actions }: Props) {
  const [activeTab, setActiveTab] = useState('summary');

  const summarySection = getSectionByType(report, 'summary_cards');
  const metricsSection = getSectionByType(report, 'metric_breakdown');
  const distributionsSection = getSectionByType(report, 'distribution_chart');
  const complianceSection = getSectionByType(report, 'compliance_table');
  const narrativeSection = getSectionByType(report, 'narrative');
  const recommendationsSection = getSectionByType(report, 'issues_recommendations');
  const exemplarsSection = getSectionByType(report, 'exemplars');
  const promptGapSection = getSectionByType(report, 'prompt_gap_analysis');
  const frictionSection = getSectionByType(report, 'friction_analysis');
  const legacyFrictionCallout = getSectionByVariant(report, 'friction_analysis', 'callout');

  const cards = useMemo(() => summaryCardMap(summarySection), [summarySection]);
  const isAdversarial = report.metadata.evalType === 'batch_adversarial';
  const summaryMetrics = useMemo(() => buildSummaryMetrics(metricsSection, isAdversarial), [isAdversarial, metricsSection]);
  const legacyNarrative = useMemo(
    () => buildNarrative(narrativeSection, recommendationsSection, promptGapSection),
    [narrativeSection, promptGapSection, recommendationsSection],
  );
  const issues = useMemo(
    () => buildIssueRows(narrativeSection, recommendationsSection),
    [narrativeSection, recommendationsSection],
  );
  const recommendations = useMemo(
    () => buildRecommendationRows(narrativeSection, recommendationsSection),
    [narrativeSection, recommendationsSection],
  );
  const verdictDistributions = useMemo(
    () => buildVerdictDistributions(distributionsSection),
    [distributionsSection],
  );
  const adversarialBreakdown = useMemo(
    () => buildAdversarialBreakdown(distributionsSection),
    [distributionsSection],
  );
  const ruleCompliance = useMemo(
    () => buildRuleCompliance(complianceSection),
    [complianceSection],
  );
  const exemplars = useMemo(() => buildExemplars(exemplarsSection), [exemplarsSection]);

  const healthCard = firstCard(cards, ['health-score', 'overall-score', 'score', 'avg-score']);
  const grade = healthCard?.subtitle ?? 'N/A';
  const numericScore = parseNumeric(healthCard?.value);
  const completed = parseNumeric(firstCard(cards, ['completed', 'passed', 'completed-threads', 'completed-tests'])?.value);
  const total = parseNumeric(firstCard(cards, ['total', 'total-threads', 'total-tests', 'all'])?.value);
  const errors = parseNumeric(firstCard(cards, ['errors', 'failed', 'failed-threads', 'failed-tests'])?.value);
  const reportLabel = report.metadata.reportId;
  const reportName = report.metadata.reportName || report.metadata.runName || 'Evaluation Report';
  const formattedDate = new Date(report.metadata.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const modelLabel = report.metadata.llmProvider && report.metadata.llmModel
    ? `${report.metadata.llmProvider} · ${report.metadata.llmModel}`
    : report.metadata.llmModel || report.metadata.llmProvider;
  const threadLabel = isAdversarial ? 'tests' : 'threads';

  return (
    <div className="relative">
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
          {reportLabel ? (
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
              {reportLabel}
            </div>
          ) : null}
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '4px 0' }}>
            {reportName}
          </h1>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0' }}>
            {report.metadata.evalType} · {completed} / {total} {threadLabel} · {formattedDate}
          </p>
          {modelLabel ? (
            <p style={{ fontSize: '9px', color: '#64748b', marginTop: '6px' }}>
              Model: {modelLabel}
            </p>
          ) : null}
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: gradeHex(grade),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>{grade}</span>
            </div>
            <div>
              <span style={{ fontSize: '28px', fontWeight: 'bold' }}>{Math.round(numericScore)}</span>
              <span style={{ fontSize: '14px', color: '#94a3b8', marginLeft: '4px' }}>/ 100</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '6mm' }}>
          {summaryMetrics.map((metric) => (
            <div
              key={metric.key}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '8px 10px',
                borderTop: `3px solid ${METRIC_COLOR(metric.value)}`,
              }}
            >
              <p style={{ fontSize: '9px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 4px' }}>
                {metric.label}
              </p>
              <p style={{ fontSize: '18px', fontWeight: 'bold', color: METRIC_COLOR(metric.value), margin: 0 }}>
                {Math.round(metric.value)}%
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="report-container">
        <div className="report-actions flex flex-wrap items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full shadow-sm shrink-0"
            style={{ backgroundColor: gradeHex(grade) }}
          >
            <span className="text-sm font-bold text-white">{grade}</span>
          </div>

          <div className="flex h-10 items-center shrink-0">
            <span className="text-xl font-bold leading-none text-[var(--text-primary)]">{Math.round(numericScore)}</span>
            <span className="ml-1.5 text-sm leading-none text-[var(--text-muted)]">/ 100</span>
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{reportName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--text-muted)]">
              <span>{completed} / {total} {threadLabel}</span>
              <span>·</span>
              <span>{report.metadata.evalType}</span>
              <span>·</span>
              <span>{errors} errors</span>
              {modelLabel ? (
                <>
                  <span>·</span>
                  <span>{modelLabel}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{formattedDate}</span>
            </div>
          </div>

          {actions ? (
            <div className="ml-auto shrink-0 no-print">
              {actions}
            </div>
          ) : null}
        </div>

        <Tabs
          className="report-tabs mt-4"
          defaultTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            {
              id: 'summary',
              label: 'Summary',
              content: (
                <div className="space-y-6 pt-2">
                  <div className="flex flex-wrap items-center gap-6 py-3">
                    {summaryMetrics.map((metric) => (
                      <div key={metric.key} className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)]">{metric.label}</span>
                        <span className="text-sm font-bold" style={{ color: METRIC_COLOR(metric.value) }}>
                          {Math.round(metric.value)}%
                        </span>
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${metric.value}%`,
                              backgroundColor: METRIC_COLOR(metric.value),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {legacyNarrative?.executiveSummary ? (
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                        {legacyNarrative.executiveSummary}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm italic text-[var(--text-muted)]">
                      AI narrative was not generated for this report.
                    </p>
                  )}

                  <div className="grid gap-6 xl:grid-cols-2">
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top Issues</h3>
                      <IssuesTable issues={issues} limit={4} emptyLabel="No issue narratives are available for this run." />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top Recommendations</h3>
                      <RecommendationsTable recommendations={recommendations} limit={3} emptyLabel="No recommendations are available for this run." />
                    </div>
                  </div>
                </div>
              ),
            },
            {
              id: 'detailed',
              label: 'Detailed Analysis',
              content: (
                <div className="report-detailed-sections pt-2">
                  <SectionRail pageKey="detailed" />
                  <div className="space-y-8">
                    <KairaExecutiveSummarySection
                      narrative={legacyNarrative}
                      summaryMetrics={summaryMetrics}
                      issues={issues}
                      recommendations={recommendations}
                    />
                    <div className="report-section">
                      <VerdictDistributions
                        distributions={verdictDistributions}
                        isAdversarial={isAdversarial}
                        adversarialBreakdown={adversarialBreakdown}
                      />
                    </div>
                    <div className="report-section">
                      <RuleComplianceTable ruleCompliance={ruleCompliance} />
                    </div>
                    {!isAdversarial ? (
                      <KairaFrictionSection
                        friction={frictionSection}
                        legacyCallout={legacyFrictionCallout}
                        runId={runId}
                      />
                    ) : null}
                    <div className="report-section">
                      <ExemplarThreads
                        exemplars={exemplars}
                        narrative={legacyNarrative}
                        isAdversarial={isAdversarial}
                        runId={runId}
                      />
                    </div>
                    <div className="report-section">
                      <PromptGapAnalysis narrative={legacyNarrative} />
                    </div>
                    <KairaRecommendationsSection recommendations={recommendations} />
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>

      <div className="print-footer print-only hidden">
        CONFIDENTIAL — AI Evals Platform · TatvaCare
      </div>
    </div>
  );
}

export default KairaReportView;
