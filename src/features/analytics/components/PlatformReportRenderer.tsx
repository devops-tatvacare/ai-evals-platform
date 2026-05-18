import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BarChart3, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { AppId } from '@/types';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import type {
  DataQualityReport,
  EntityTableBlock,
  FrictionAnalysisSection,
  HeatmapTableBlock,
  MetricBarListBlock,
  MetricBreakdownSection,
  NarrativeSection,
  PlatformDocumentBlock,
  PlatformReportDocument,
  PlatformCrossRunNarrative,
  PlatformCrossRunPayload,
  PlatformReportSection,
  RecommendationListBlock,
  StatGridBlock,
  SummaryCardsSection,
  TableBlock,
  PlatformRunNarrative,
  PlatformRunReportPayload,
  PlatformReportPresentation,
  ProseBlock,
  CoverBlock,
} from '@/types/platformReports';
import { Button, EmptyState, LegacyLlmConfigCompat, LoadingState, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { reportsApi } from '@/services/api/reportsApi';
import { useCrossRunStore } from '@/stores';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
import { notificationService } from '@/services/notifications';
import { useAppConfig } from '@/hooks';
import SectionHeader from '@/features/evalRuns/components/report/shared/SectionHeader';
import CalloutBox from '@/features/evalRuns/components/report/shared/CalloutBox';
import VerdictDistributions from '@/features/evalRuns/components/report/VerdictDistributions';
import RuleComplianceTable from '@/features/evalRuns/components/report/RuleComplianceTable';
import ExemplarThreads from '@/features/evalRuns/components/report/ExemplarThreads';
import FrictionAnalysisView from '@/features/evalRuns/components/report/FrictionAnalysis';
import PromptGapAnalysis from '@/features/evalRuns/components/report/PromptGapAnalysis';
import Recommendations from '@/features/evalRuns/components/report/Recommendations';
import {
  transformDistributions,
  transformAdversarialBreakdown,
  transformCompliance,
  transformExemplars,
  transformNarrative,
} from '@/features/evalRuns/components/report/sectionTransforms';
import type { ComplianceTableSection, DistributionChartSection, ExemplarsSection } from '@/types/platformReports';
import { Heatmap, type HeatmapCell, type HeatmapColumn, type HeatmapRow, type HeatmapTier } from '@/components/report/Heatmap';
import {
  KpiTile,
  SectionEmpty,
  SectionHeader as ReportSectionHeader,
  SectionShell,
  toneText,
  toneRule,
  toneSurface,
  toneToCalloutVariant,
  type ReportTone,
} from './reportPrimitives';
import { cn } from '@/utils/cn';

/** Section types that render their own SectionHeader and layout — no outer box wrapper. */
const RICH_COMPONENT_IDS = new Set([
  'distribution_chart',
  'compliance_table',
  'exemplars',
  'friction_analysis',
  'prompt_gap_analysis',
  'issues_recommendations',
  'entity_slices',
]);

/**
 * Phase 2 — partial-report banner.
 *
 * Older cached artifacts have no `dataQuality` key; absence is normalized to
 * `overall: 'complete'` so the banner renders nothing for legacy reports. The
 * print watermark CSS hook is stamped on the same root via `data-partial` for
 * the PDF render path (see `report-print.css` `.report-partial-watermark`).
 */
const NARRATIVE_STATUS_COPY: Record<string, string> = {
  disabled: 'AI narrative is turned off for this report.',
  skipped_no_model: 'AI narrative was skipped — no model was available.',
  failed: 'AI narrative failed to generate.',
};

function normalizeDataQuality(dq: DataQualityReport | undefined): DataQualityReport {
  return dq ?? { overall: 'complete', missingInputs: [], sectionStatus: {} };
}

function DataQualityBanner({
  report,
  printMode,
}: {
  report: PlatformRunReportPayload;
  printMode: boolean;
}) {
  const dq = normalizeDataQuality(report.dataQuality);
  const narrativeStatus = report.metadata.narrativeStatus;
  const narrativeMessage =
    narrativeStatus && narrativeStatus !== 'completed'
      ? NARRATIVE_STATUS_COPY[narrativeStatus]
      : null;

  const showBanner = dq.overall !== 'complete' || Boolean(narrativeMessage);
  if (!showBanner) return null;

  const missingCount = dq.missingInputs.length;
  const droppedSections = Object.entries(dq.sectionStatus).filter(
    ([, status]) => status === 'dropped_from_export' || status === 'empty',
  );

  const variant = dq.overall === 'degraded' ? 'danger' : 'warning';
  const title =
    dq.overall === 'degraded'
      ? 'Report is degraded — multiple inputs are missing.'
      : dq.overall === 'partial'
        ? 'This report is partial.'
        : 'AI narrative status';

  return (
    <div
      className="report-partial-banner"
      data-partial={dq.overall !== 'complete' ? 'true' : undefined}
    >
      {printMode && dq.overall !== 'complete' ? (
        <div className="report-partial-watermark">PARTIAL</div>
      ) : null}
      <CalloutBox variant={variant} title={title}>
        <div className="space-y-1">
          {missingCount > 0 ? (
            <div>
              {missingCount} expected input{missingCount === 1 ? '' : 's'} missing
              {missingCount <= 4 ? `: ${dq.missingInputs.join(', ')}` : '.'}
            </div>
          ) : null}
          {droppedSections.length > 0 ? (
            <div>
              {droppedSections.length} section
              {droppedSections.length === 1 ? '' : 's'} dropped or empty:{' '}
              {droppedSections.map(([id]) => id).join(', ')}.
            </div>
          ) : null}
          {narrativeMessage ? <div>{narrativeMessage}</div> : null}
        </div>
      </CalloutBox>
    </div>
  );
}

function normalizeTokenKey(key: string): string {
  return key.replace(/[_\s-]+/g, '').toLowerCase();
}

function buildReportPresentationStyle(report: PlatformRunReportPayload): CSSProperties {
  const style: CSSProperties = {};
  const cssVars = style as CSSProperties & Record<string, string>;
  const themeTokens = report.presentation?.themeTokens ?? {};
  const designTokens = report.presentation?.designTokens ?? {};
  const tokenMap: Record<string, string> = {
    accent: '--color-brand-accent',
    accentmuted: '--surface-info',
    background: '--bg-primary',
    surface: '--bg-secondary',
    surfacemuted: '--bg-tertiary',
    border: '--border-default',
    bordersubtle: '--border-subtle',
    textprimary: '--text-primary',
    textsecondary: '--text-secondary',
    textmuted: '--text-muted',
    interactiveprimary: '--interactive-primary',
    textoncolor: '--text-on-color',
    textbrand: '--text-brand',
    info: '--color-info',
  };

  for (const [rawKey, value] of Object.entries(themeTokens)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalized = normalizeTokenKey(rawKey);
    const target = rawKey.startsWith('--') ? rawKey : tokenMap[normalized];
    if (target) cssVars[target] = value;
  }

  for (const [rawKey, value] of Object.entries(designTokens)) {
    if (value == null) continue;
    cssVars[`--report-design-${rawKey}`] = String(value);
  }

  const maxWidth = designTokens.contentMaxWidth ?? designTokens.maxWidth;
  if (typeof maxWidth === 'number') style.maxWidth = `${maxWidth}px`;
  if (typeof maxWidth === 'string') style.maxWidth = maxWidth;

  return style;
}

const BACKEND_TONE_TO_TIER: Record<string, HeatmapTier> = {
  positive: 'great',
  success: 'great',
  warning: 'mid',
  negative: 'critical',
  danger: 'critical',
  error: 'critical',
  info: 'good',
  neutral: 'neutral',
};

function tierFromTone(tone: string | null | undefined): HeatmapTier | null {
  if (!tone) return null;
  return BACKEND_TONE_TO_TIER[tone] ?? null;
}

function buildDocumentStyle(report: PlatformRunReportPayload): CSSProperties {
  const style = buildReportPresentationStyle(report);
  const cssVars = style as CSSProperties & Record<string, string>;
  const theme = report.exportDocument?.theme;
  if (theme) {
    cssVars['--report-doc-accent'] = theme.accent;
    cssVars['--report-doc-accent-muted'] = theme.accentMuted;
    cssVars['--report-doc-border'] = theme.border;
    cssVars['--report-doc-text-primary'] = theme.textPrimary;
    cssVars['--report-doc-text-secondary'] = theme.textSecondary;
    cssVars['--report-doc-background'] = theme.background;
  }

  if (!style.maxWidth) {
    style.maxWidth = '1080px';
  }

  return style;
}

type PresentationSection = PlatformReportPresentation['sections'][number];

function getPresentationSections(report: PlatformRunReportPayload): PresentationSection[] {
  return report.presentation.sections ?? [];
}

function getPresentationSectionMap(report: PlatformRunReportPayload): Map<string, PresentationSection> {
  return new Map(getPresentationSections(report).map((section) => [section.sectionId, section]));
}

function getSectionComponentId(section: PlatformReportSection, presentationSection?: PresentationSection): string {
  return presentationSection?.componentId ?? section.type;
}

function blockToneTextStyle(tone: ReportTone | null | undefined) {
  return { color: toneText(tone) };
}

function blockToneSurfaceStyle(tone: ReportTone | null | undefined) {
  return { backgroundColor: toneSurface(tone) };
}

function PreviewBlockTitle({ title }: { title?: string | null }) {
  if (!title) return null;
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--report-doc-text-secondary)]">
        {title}
      </h3>
    </div>
  );
}

function ReportCoverBlockView({ block }: { block: CoverBlock }) {
  const metadataEntries = Object.entries(block.metadata ?? {});

  return (
    <section
      className="overflow-hidden rounded-[24px] px-6 py-7 text-white md:px-8 md:py-9"
      style={{
        background: 'linear-gradient(135deg, var(--report-doc-accent) 0%, color-mix(in srgb, var(--report-doc-accent) 68%, var(--color-neutral-900) 32%) 45%, var(--color-neutral-900) 100%)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
        <span>Single-run report</span>
      </div>
      <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] md:text-[2.35rem]">
        {block.title}
      </h2>
      {block.subtitle ? (
        <p className="mt-3 max-w-3xl text-sm leading-6 text-white/82 md:text-[15px]">
          {block.subtitle}
        </p>
      ) : null}
      {metadataEntries.length > 0 ? (
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {metadataEntries.map(([key, value]) => (
            <div key={key} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/70">{key}</div>
              <div className="mt-1 text-sm font-medium text-white">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReportStatGridBlockView({ block }: { block: StatGridBlock }) {
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-[var(--bg-elevated)] p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {block.items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="rounded-[18px] border border-[var(--report-doc-border)] bg-[var(--report-doc-background)] p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--report-doc-text-secondary)]">{item.label}</div>
            <div className="mt-2 text-[30px] font-semibold leading-none tabular-nums" style={blockToneTextStyle(item.tone)}>{item.value}</div>
            <div className="mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ ...blockToneSurfaceStyle(item.tone), ...blockToneTextStyle(item.tone) }}>
              {item.tone}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportProseBlockView({ block }: { block: ProseBlock }) {
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-[var(--bg-elevated)] p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="space-y-3 text-[15px] leading-7 text-[var(--report-doc-text-primary)]">
        {block.body.split('\n').filter((paragraph) => paragraph.trim()).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

function ReportTableBlockView({ block }: { block: TableBlock | EntityTableBlock }) {
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-[var(--bg-elevated)] p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {block.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    'border-b border-[var(--report-doc-border)] px-3 py-3 text-xs uppercase tracking-[0.16em] text-[var(--report-doc-text-secondary)]',
                    column.align === 'right'
                      ? 'text-right'
                      : column.align === 'center'
                        ? 'text-center'
                        : 'text-left',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'border-b border-[var(--report-doc-border)] px-3 py-3 text-sm tabular-nums text-[var(--report-doc-text-primary)]',
                      column.align === 'right'
                        ? 'text-right'
                        : column.align === 'center'
                          ? 'text-center'
                          : 'text-left',
                    )}
                  >
                    {row[column.key] == null ? '—' : String(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReportHeatmapBlockView({ block }: { block: HeatmapTableBlock }) {
  const columns: HeatmapColumn[] = block.columns.map((label, idx) => ({ id: `${label}-${idx}`, label }));
  const rows: HeatmapRow[] = block.rows.map((row, rowIdx) => ({
    id: `${row.label}-${rowIdx}`,
    label: row.label,
    cells: row.cells.map((cell): HeatmapCell => ({
      value: cell.value,
      tier: tierFromTone(cell.tone),
      display: cell.value == null ? '—' : String(cell.value),
    })),
  }));
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-[var(--bg-elevated)] p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <Heatmap columns={columns} rows={rows} rowHeaderLabel="Metric" />
    </section>
  );
}

function ReportMetricBarBlockView({ block }: { block: MetricBarListBlock }) {
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-[var(--bg-elevated)] p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="space-y-4">
        {block.items.map((item, index) => {
          const percent = item.maxValue > 0 ? Math.min(Math.max((item.value / item.maxValue) * 100, 0), 100) : 0;
          const fillColor = toneRule(item.tone) ?? 'var(--report-doc-accent)';
          return (
            <div key={`${item.label}-${index}`}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-[var(--report-doc-text-secondary)]">{item.label}</span>
                <span className="font-semibold tabular-nums" style={blockToneTextStyle(item.tone)}>{item.value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)]">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${percent}%`, backgroundColor: fillColor }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReportRecommendationListBlockView({ block }: { block: RecommendationListBlock }) {
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-[var(--bg-elevated)] p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="grid gap-3">
        {block.items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="flex gap-3 rounded-[18px] border border-[var(--report-doc-border)] bg-[var(--report-doc-background)] p-4">
            <div className="inline-flex h-7 min-w-11 items-center justify-center rounded-full bg-[var(--report-doc-accent-muted)] px-3 text-[11px] font-semibold text-[var(--report-doc-accent)]">
              {item.priority}
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--report-doc-text-primary)]">{item.title}</div>
              <div className="mt-1 text-sm text-[var(--report-doc-text-secondary)]">{item.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportDocumentBlockView({ block }: { block: PlatformDocumentBlock }) {
  if (block.type === 'cover') {
    return <ReportCoverBlockView block={block} />;
  }

  if (block.type === 'stat_grid') {
    return <ReportStatGridBlockView block={block} />;
  }

  if (block.type === 'prose') {
    return <ReportProseBlockView block={block} />;
  }

  if (block.type === 'table') {
    return <ReportTableBlockView block={block} />;
  }

  if (block.type === 'heatmap_table') {
    return <ReportHeatmapBlockView block={block} />;
  }

  if (block.type === 'metric_bar_list') {
    return <ReportMetricBarBlockView block={block} />;
  }

  if (block.type === 'recommendation_list') {
    return <ReportRecommendationListBlockView block={block} />;
  }

  if (block.type === 'entity_table') {
    return <ReportTableBlockView block={block} />;
  }

  if (block.type === 'page_break') {
    return <div className="my-1 border-t border-dashed border-[var(--report-doc-border)]" />;
  }

  return null;
}

function ReportDocumentPreview({ document, report }: { document: PlatformReportDocument; report: PlatformRunReportPayload }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/95 p-3 shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
      <div
        className="mx-auto space-y-4 rounded-[24px] p-3 md:p-4"
        style={buildDocumentStyle(report)}
      >
        {document.blocks.map((block, index) => (
          <ReportDocumentBlockView key={`${block.id}-${index}`} block={block} />
        ))}
      </div>
    </div>
  );
}

function SectionContent({
  section,
  presentationSection,
  report,
  printMode = false,
}: {
  section: PlatformReportSection;
  presentationSection?: PresentationSection;
  report?: PlatformRunReportPayload;
  /** Forwarded to children that have a collapsed-by-default state — currently
   *  ExemplarThreads transcripts. Static-artifact targets (PDF) need every
   *  click-to-reveal panel pre-expanded. */
  printMode?: boolean;
}) {
  const componentId = getSectionComponentId(section, presentationSection);

  if (componentId === 'summary_cards') {
    const summarySection = section as SummaryCardsSection;
    if (summarySection.data.length === 0) {
      return <SectionEmpty title="No KPIs reported" description="The producer did not emit any summary cards." />;
    }
    return (
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {summarySection.data.map((item) => (
          <KpiTile
            key={item.key}
            label={item.label}
            value={item.value}
            subtitle={item.subtitle}
            tone={item.tone as ReportTone}
          />
        ))}
      </div>
    );
  }

  if (componentId === 'narrative') {
    const narrative = (section as NarrativeSection).data as PlatformRunNarrative | PlatformCrossRunNarrative;
    return (
      <div className="space-y-4">
        {narrative.executiveSummary ? (
          <SectionShell tone="info">
            <ReportSectionHeader kicker="Executive summary" title="Headline" />
            <p className="text-sm leading-relaxed text-[var(--text-primary)]">{narrative.executiveSummary}</p>
          </SectionShell>
        ) : null}
        {'trendAnalysis' in narrative && narrative.trendAnalysis ? (
          <SectionShell tone="info">
            <ReportSectionHeader kicker="Trend" title="Trend analysis" />
            <p className="text-sm leading-relaxed text-[var(--text-primary)]">{narrative.trendAnalysis}</p>
          </SectionShell>
        ) : null}
        {'issues' in narrative && narrative.issues.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {narrative.issues.map((issue) => {
              const severity = ('severity' in issue ? issue.severity : null) as ReportTone | null;
              return (
                <SectionShell key={`${issue.area}-${issue.title}`} tone={severity ?? 'warning'}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{issue.area}</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{issue.title}</div>
                  <div className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{issue.summary}</div>
                </SectionShell>
              );
            })}
          </div>
        ) : null}
        {'recommendations' in narrative && narrative.recommendations.length > 0 ? (
          <div className="space-y-2">
            {narrative.recommendations.map((item, index) => {
              const rationale = 'rationale' in item && typeof item.rationale === 'string' ? item.rationale : null;
              const expectedImpact = 'expectedImpact' in item && typeof item.expectedImpact === 'string' ? item.expectedImpact : null;
              return (
                <SectionShell key={`${item.priority}-${index}`} tone="info">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                      style={{ backgroundColor: toneSurface('info'), color: toneText('info') }}
                    >
                      {item.priority}
                    </span>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{item.action}</span>
                  </div>
                  {rationale ? <div className="mt-1 text-xs text-[var(--text-secondary)]">{rationale}</div> : null}
                  {expectedImpact ? <div className="mt-1 text-xs text-[var(--text-secondary)]">{expectedImpact}</div> : null}
                </SectionShell>
              );
            })}
          </div>
        ) : null}
        {'criticalPatterns' in narrative && narrative.criticalPatterns.length > 0 ? (
          <div className="space-y-2">
            {narrative.criticalPatterns.map((item, index) => (
              <SectionShell key={`${item.title}-${index}`} tone="warning">
                <div className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">{item.summary}</div>
              </SectionShell>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (componentId === 'metric_breakdown') {
    const metricSection = section as MetricBreakdownSection;
    if (metricSection.data.length === 0) {
      return <SectionEmpty title="No metrics" description="The producer did not emit any metrics for this section." />;
    }
    return (
      <div className="space-y-3">
        {metricSection.data.map((item) => {
          const percent = item.maxValue > 0 ? Math.min(Math.max((item.value / item.maxValue) * 100, 0), 100) : 0;
          const fill = toneRule(item.tone) ?? 'var(--color-info)';
          return (
            <div key={item.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">{item.label}</span>
                <span className="tabular-nums" style={{ color: toneText(item.tone) }}>
                  {item.value.toFixed(1)}{item.unit ?? ''}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                <div className="h-full rounded-full transition-[width]" style={{ width: `${percent}%`, backgroundColor: fill }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (componentId === 'distribution_chart') {
    const distSection = section as DistributionChartSection;
    const distributions = transformDistributions(distSection);
    const isAdversarial = report?.metadata.evalType === 'batch_adversarial';
    const adversarialBreakdown = transformAdversarialBreakdown(distSection);
    return (
      <VerdictDistributions
        distributions={distributions}
        isAdversarial={isAdversarial}
        adversarialBreakdown={adversarialBreakdown}
      />
    );
  }

  if (componentId === 'compliance_table') {
    const complianceSection = section as ComplianceTableSection;
    const ruleCompliance = transformCompliance(complianceSection);
    return <RuleComplianceTable ruleCompliance={ruleCompliance} />;
  }

  if (componentId === 'heatmap') {
    const heatmapSection = section as Extract<PlatformReportSection, { type: 'heatmap' }>;
    const { columns: cols, rows: heatRows } = heatmapSection.data;
    const columns: HeatmapColumn[] = cols.map((label, idx) => ({ id: `${label}-${idx}`, label }));
    const rows: HeatmapRow[] = heatRows.map((row) => ({
      id: row.key,
      label: row.label,
      cells: row.cells.map((cell): HeatmapCell => ({
        value: cell.value,
        tier: tierFromTone(cell.tone),
        display: cell.value == null ? '—' : String(cell.value),
        subtitle: cell.subtitle,
      })),
    }));
    return <Heatmap columns={columns} rows={rows} rowHeaderLabel="Metric" />;
  }

  if (componentId === 'entity_slices') {
    const entitySection = section as Extract<PlatformReportSection, { type: 'entity_slices' }>;
    const items = entitySection.data;
    if (items.length === 0) {
      return <SectionEmpty title="No entities" description="The producer did not emit any entity rows for this section." />;
    }
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => {
          const detailEntries = Object.entries(item.details ?? {});
          return (
            <SectionShell key={item.entityId}>
              <div className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {Object.entries(item.summary).map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="text-[var(--text-muted)] truncate">{key.replace(/_/g, ' ')}</dt>
                    <dd className="font-medium tabular-nums text-[var(--text-primary)]">{String(value)}</dd>
                  </div>
                ))}
              </dl>
              {detailEntries.length > 0 ? (
                <dl className="mt-3 border-t border-[var(--border-subtle)] pt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {detailEntries.map(([key, value]) => (
                    <div key={key} className="flex items-baseline justify-between gap-2 text-xs">
                      <dt className="text-[var(--text-muted)] truncate">{key.replace(/_/g, ' ')}</dt>
                      <dd className="font-medium tabular-nums text-[var(--text-secondary)]">{String(value ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </SectionShell>
          );
        })}
      </div>
    );
  }

  if (componentId === 'flags') {
    const flagsSection = section as Extract<PlatformReportSection, { type: 'flags' }>;
    if (flagsSection.data.length === 0) {
      return <SectionEmpty title="No flags" description="No behavioural flags were recorded for this run." />;
    }
    return (
      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--bg-secondary)]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Flag</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Relevant</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Present</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Attempted</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {flagsSection.data.map((item, idx) => (
              <tr key={item.key} className={cn('border-t border-[var(--border-subtle)]', idx === 0 && 'border-t-0')}>
                <td className="px-3 py-2 text-[var(--text-primary)]">{item.label}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{item.relevant}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{item.present}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{item.attempted ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">{item.accepted ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (componentId === 'issues_recommendations') {
    const narrative = report ? transformNarrative(report) : null;
    return <Recommendations narrative={narrative} />;
  }

  if (componentId === 'exemplars') {
    const exemplarsSection = section as ExemplarsSection;
    const exemplars = transformExemplars(exemplarsSection);
    const narrative = report ? transformNarrative(report) : null;
    const isAdversarial = report?.metadata.evalType === 'batch_adversarial';
    return (
      <ExemplarThreads
        exemplars={exemplars}
        narrative={narrative}
        isAdversarial={isAdversarial}
        runId={report?.metadata.runId}
        printMode={printMode}
      />
    );
  }

  if (componentId === 'prompt_gap_analysis') {
    const narrative = report ? transformNarrative(report) : null;
    return <PromptGapAnalysis narrative={narrative} />;
  }

  if (componentId === 'friction_analysis') {
    const friction = (section as FrictionAnalysisSection).data;
    return <FrictionAnalysisView friction={friction} runId={report?.metadata.runId} />;
  }

  if (componentId === 'callout') {
    const calloutSection = section as Extract<PlatformReportSection, { type: 'callout' }>;
    return (
      <CalloutBox variant={toneToCalloutVariant(calloutSection.data.tone)} title={section.title}>
        {calloutSection.data.message}
      </CalloutBox>
    );
  }

  return null;
}


const LEGACY_SUMMARY_COMPONENT_IDS = new Set([
  'summary_cards',
  'metric_breakdown',
  'callout',
  'narrative',
  'issues_recommendations',
]);

function getLayoutGroupSectionIds(report: PlatformRunReportPayload, tab: string): string[] {
  const ids: string[] = [];
  for (const group of report.presentation.layoutGroups ?? []) {
    if (!group || typeof group !== 'object') continue;
    const candidate = group as Record<string, unknown>;
    const groupTab = typeof candidate.tab === 'string'
      ? candidate.tab
      : typeof candidate.pageKey === 'string'
        ? candidate.pageKey
        : null;
    if (groupTab !== tab) continue;
    const rawSectionIds = Array.isArray(candidate.sectionIds)
      ? candidate.sectionIds
      : Array.isArray(candidate.sections)
        ? candidate.sections
        : [];
    for (const sectionId of rawSectionIds) {
      if (typeof sectionId === 'string' && !ids.includes(sectionId)) {
        ids.push(sectionId);
      }
    }
  }
  return ids;
}

function getSectionsForTab(report: PlatformRunReportPayload, tab: 'summary' | 'detailed'): PlatformReportSection[] {
  const sectionById = new Map(report.sections.map((section) => [section.id, section]));
  const configuredSectionIds = getLayoutGroupSectionIds(report, tab);
  if (configuredSectionIds.length > 0) {
    return configuredSectionIds
      .map((sectionId) => sectionById.get(sectionId))
      .filter((section): section is PlatformReportSection => section != null);
  }

  const presentationSections = getPresentationSections(report);
  if (presentationSections.length > 0) {
    if (tab === 'summary') {
      return presentationSections
        .filter((section) => LEGACY_SUMMARY_COMPONENT_IDS.has(section.componentId))
        .map((section) => sectionById.get(section.sectionId))
        .filter((section): section is PlatformReportSection => section != null);
    }

    return presentationSections
      .map((section) => sectionById.get(section.sectionId))
      .filter((section): section is PlatformReportSection => section != null);
  }

  if (tab === 'summary') {
    return report.sections.filter((section) => LEGACY_SUMMARY_COMPONENT_IDS.has(section.type));
  }

  return report.sections;
}

function SummarySectionContent({
  section,
  presentationSection,
  report,
}: {
  section: PlatformReportSection;
  presentationSection?: PresentationSection;
  report?: PlatformRunReportPayload;
}) {
  const componentId = getSectionComponentId(section, presentationSection);

  if (componentId === 'summary_cards') {
    return null;
  }

  if (componentId === 'metric_breakdown') {
    const metricSection = section as MetricBreakdownSection;
    if (metricSection.data.length === 0) {
      return <SectionEmpty title="No metrics" description="The producer did not emit any metrics for this section." />;
    }
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metricSection.data.map((metric) => {
          const pct = metric.maxValue > 0 ? Math.round((metric.value / metric.maxValue) * 100) : 0;
          const fill = toneRule(metric.tone) ?? 'var(--color-brand-accent)';
          return (
            <div key={metric.key}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{metric.label}</div>
              <div className="mt-1 text-[20px] font-semibold tabular-nums leading-tight" style={{ color: toneText(metric.tone) }}>{pct}%</div>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: fill }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (componentId === 'narrative') {
    const narrativeData = (section as NarrativeSection).data as PlatformRunNarrative | undefined;
    return narrativeData?.executiveSummary ? (
      <SectionShell tone="info" bodyClassName="px-4 py-3">
        <p className="text-sm leading-relaxed text-[var(--text-primary)]">{narrativeData.executiveSummary}</p>
      </SectionShell>
    ) : (
      <SectionEmpty title="AI narrative was not generated" description="No model was available, or narrative was disabled for this report." />
    );
  }

  if (componentId === 'issues_recommendations') {
    const narrative = report ? transformNarrative(report) : null;
    const topIssues = narrative?.topIssues ?? [];
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <ReportSectionHeader kicker="Top issues" title="Most impactful problems" />
          {topIssues.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-secondary)]">
                  <tr>
                    <th className="w-3 px-2 py-2" />
                    <th className="text-left px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Issue</th>
                    <th className="text-left px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Focus area</th>
                    <th className="text-right px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Affected</th>
                  </tr>
                </thead>
                <tbody>
                  {topIssues.slice(0, 5).map((issue, i) => {
                    const dotTone: ReportTone = i < 2 ? 'error' : i < 4 ? 'warning' : 'info';
                    return (
                      <tr key={issue.rank} className="border-t border-[var(--border-subtle)]">
                        <td className="px-2 py-2 align-top">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: toneText(dotTone) }} />
                        </td>
                        <td className="px-2 py-2 align-top font-medium text-[var(--text-primary)]">{issue.description}</td>
                        <td className="px-2 py-2 align-top text-[var(--text-secondary)] whitespace-nowrap">{issue.area}</td>
                        <td className="px-2 py-2 align-top text-right tabular-nums text-[var(--text-secondary)]">{issue.affectedCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <SectionEmpty title="No issue narratives" description="No issue narratives are available for this run." />
          )}
        </div>
        <div className="space-y-2">
          <ReportSectionHeader kicker="Top recommendations" title="What to do next" />
          <Recommendations narrative={narrative} />
        </div>
      </div>
    );
  }

  if (componentId === 'callout') {
    return <SectionContent section={section} presentationSection={presentationSection} report={report} />;
  }

  if (RICH_COMPONENT_IDS.has(componentId)) {
    return <SectionContent section={section} presentationSection={presentationSection} report={report} />;
  }

  return (
    <div>
      <SectionHeader title={section.title} description={section.description ?? undefined} />
      <SectionContent section={section} presentationSection={presentationSection} report={report} />
    </div>
  );
}

interface PlatformReportViewProps {
  report: PlatformRunReportPayload;
  /** Live UI passes the export/refresh button cluster; print mode passes nothing. */
  actions?: ReactNode;
  /**
   * When true, render only the detailed-analysis section list inline — no Tabs,
   * no actions slot — and propagate `printMode` to children that have a
   * collapsed-by-default state (e.g. exemplar transcripts) so the static
   * artifact carries every piece of evidence the live UI exposes via clicks.
   *
   * This is the single source of truth for the headless PDF render: the print
   * route mounts this same component with `printMode`, guaranteeing the PDF
   * cannot drift from the Detailed tab of the live UI.
   */
  printMode?: boolean;
}

export function PlatformReportView({ report, actions, printMode = false }: PlatformReportViewProps) {
  const [activeTab, setActiveTab] = useState('summary');
  const reportTitle = report.metadata.runName || report.metadata.reportName || 'Evaluation Report';
  const modelLabel = report.metadata.llmProvider && report.metadata.llmModel
    ? `${report.metadata.llmProvider} · ${report.metadata.llmModel}`
    : null;
  const hasRenderableSections = report.sections.length > 0;
  const summaryCardsSection = report.sections.find((section) => section.type === 'summary_cards') as SummaryCardsSection | undefined;
  const summaryCards = summaryCardsSection?.data ?? [];
  const primaryCard = summaryCards[0] ?? null;
  const secondaryCards = primaryCard ? summaryCards.slice(1) : summaryCards;
  const summarySections = getSectionsForTab(report, 'summary');
  const detailedSections = getSectionsForTab(report, 'detailed');
  const presentationSectionMap = getPresentationSectionMap(report);

  const gradeColor = primaryCard ? (toneRule(primaryCard.tone) ?? 'var(--text-muted)') : 'var(--text-muted)';

  const headerCard = (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
      {primaryCard ? (
        <>
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full shrink-0"
            style={{ backgroundColor: gradeColor }}
          >
            <span className="text-sm font-bold text-white">{primaryCard.subtitle ?? ''}</span>
          </div>
          <div className="flex h-10 items-center shrink-0">
            <span className="text-xl font-bold leading-none text-[var(--text-primary)]">{primaryCard.value}</span>
            <span className="ml-1.5 text-sm leading-none text-[var(--text-muted)]">/ 100</span>
          </div>
        </>
      ) : null}

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{reportTitle}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--text-muted)]">
          {secondaryCards.map((card) => (
            <span key={card.key}>{card.value} {card.label.toLowerCase()}</span>
          ))}
          {report.metadata.evalType ? <><span>·</span><span>{report.metadata.evalType}</span></> : null}
          {modelLabel ? <><span>·</span><span>{modelLabel}</span></> : null}
          <span>·</span>
          <span>{new Date(report.metadata.computedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      </div>

      {!printMode ? <div className="ml-auto shrink-0">{actions}</div> : null}
    </div>
  );

  // The platform's `presentation.sections[*].printable` flag is the canonical
  // way for a backend profile or Sherlock blueprint to opt a section out of
  // the static artifact (e.g. an interactive control panel that has no value
  // on paper). It defaults to `true`, so unflagged sections always print.
  // We honour it ONLY when rendering for print — the live UI still shows the
  // full Detailed tab regardless of the flag.
  const detailedSectionsToRender = printMode
    ? detailedSections.filter((section) => {
        const pSection = presentationSectionMap.get(section.id);
        return pSection ? pSection.printable !== false : true;
      })
    : detailedSections;

  const detailedSectionList = (
    <div className={cn('space-y-8', printMode && 'space-y-5')}>
      {detailedSectionsToRender.map((section) => {
        const pSection = presentationSectionMap.get(section.id);
        const cId = getSectionComponentId(section, pSection);
        const isRich = RICH_COMPONENT_IDS.has(cId);
        // `break-inside-avoid` keeps each rich card from splitting across PDF
        // pages. It's a no-op on screen because the Detailed tab is one
        // continuous scroll surface — no page breaks to honour.
        return isRich ? (
          <div key={section.id} className="break-inside-avoid">
            <SectionContent section={section} presentationSection={pSection} report={report} printMode={printMode} />
          </div>
        ) : (
          <section key={section.id} className={cn('break-inside-avoid', printMode ? 'space-y-2' : 'space-y-4')}>
            <SectionHeader title={section.title} description={section.description ?? undefined} />
            <SectionContent section={section} presentationSection={pSection} report={report} printMode={printMode} />
          </section>
        );
      })}
    </div>
  );

  if (printMode) {
    return (
      <div className="space-y-6" style={buildReportPresentationStyle(report)}>
        <DataQualityBanner report={report} printMode />
        {headerCard}
        {hasRenderableSections
          ? detailedSectionList
          : report.exportDocument
            ? <ReportDocumentPreview document={report.exportDocument} report={report} />
            : null}
      </div>
    );
  }

  return (
    <div className="space-y-6" style={buildReportPresentationStyle(report)}>
      <DataQualityBanner report={report} printMode={false} />
      {headerCard}

      {hasRenderableSections ? (
        <Tabs
          className="mt-2"
          defaultTab={activeTab}
          onChange={setActiveTab}
          tabs={[
            {
              id: 'summary',
              label: 'Summary',
              content: (
                <div className="space-y-6 pt-2">
                  {summarySections.length > 0 ? summarySections.map((section) => (
                    <SummarySectionContent
                      key={section.id}
                      section={section}
                      presentationSection={presentationSectionMap.get(section.id)}
                      report={report}
                    />
                  )) : (
                    <div className="text-sm text-[var(--text-muted)]">No summary sections are configured for this report.</div>
                  )}
                </div>
              ),
            },
            {
              id: 'detailed',
              label: 'Detailed Analysis',
              content: <div className="pt-2">{detailedSectionList}</div>,
            },
          ]}
        />
      ) : report.exportDocument ? (
        <ReportDocumentPreview document={report.exportDocument} report={report} />
      ) : null}
    </div>
  );
}

function CrossRunSummaryCard({ summary }: { summary: PlatformCrossRunNarrative }) {
  return (
    <div className="space-y-3">
      <SectionShell tone="info">
        <ReportSectionHeader kicker="AI cross-run summary" title="Executive summary" />
        <p className="text-sm leading-relaxed text-[var(--text-primary)]">{summary.executiveSummary}</p>
      </SectionShell>
      {summary.trendAnalysis ? (
        <SectionShell tone="info">
          <ReportSectionHeader kicker="Trend" title="Trend analysis" />
          <p className="text-sm leading-relaxed text-[var(--text-primary)]">{summary.trendAnalysis}</p>
        </SectionShell>
      ) : null}
      {summary.criticalPatterns.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {summary.criticalPatterns.map((item, index) => (
            <SectionShell key={`${item.title}-${index}`} tone="warning">
              <div className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{item.summary}</div>
            </SectionShell>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PlatformCrossRunDashboard({ appId }: { appId: AppId }) {
  const appConfig = useAppConfig(appId);
  const { icon: pageIcon, title: pageTitle } = usePageMetadata('dashboard');
  const loadAnalytics = useCrossRunStore((s) => s.loadAnalytics);
  const refreshAnalytics = useCrossRunStore((s) => s.refreshAnalytics);
  const entry = useCrossRunStore((s) => s.entries[appId]);
  const analytics = entry?.data as PlatformCrossRunPayload | null | undefined;

  const [summary, setSummary] = useState<PlatformCrossRunNarrative | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [provider, setProvider] = useState<LLMProvider | ''>('');
  const [model, setModel] = useState('');

  // Server-resolved BYOK: the summary job runs once the user has picked a
  // provider+model from the admin-configured catalogue. The query is the
  // single source of truth for "is this provider usable right now".
  const { data: providerConfigs = [] } = useProviderConfigs();
  const credentialsReady = useMemo(
    () =>
      Boolean(provider) &&
      providerConfigs.some(
        (c) =>
          c.provider === provider &&
          c.isEnabled &&
          c.validationStatus === 'ok',
      ),
    [providerConfigs, provider],
  );

  useEffect(() => {
    void loadAnalytics(appId);
  }, [appId, loadAnalytics]);

  useEffect(() => {
    if (!showModelPicker) return;
    const handleClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModelPicker]);

  const headerActions = useMemo(() => (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void refreshAnalytics(appId)}>
        Refresh
      </Button>
      {appConfig.analytics.capabilities.crossRunAiSummary && (
        <div className="relative" ref={pickerRef}>
          <Button variant="secondary" size="sm" icon={Sparkles} onClick={() => setShowModelPicker((value) => !value)}>
            AI Summary
          </Button>
          {showModelPicker && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 shadow-lg">
              <LegacyLlmConfigCompat
                callSite="report_generation"
                provider={provider}
                onProviderChange={(value) => { setProvider(value); setModel(''); }}
                model={model}
                onModelChange={setModel}
                compact
              />
              <Button
                variant="primary"
                size="sm"
                icon={Sparkles}
                className="mt-3 w-full"
                disabled={!credentialsReady || !model || generatingSummary}
                onClick={async () => {
                  setGeneratingSummary(true);
                  setShowModelPicker(false);
                  try {
                    const result = await reportsApi.generateCrossRunSummary({
                      appId,
                      provider,
                      model,
                    });
                    setSummary(result);
                  } catch (error) {
                    notificationService.error(error instanceof Error ? error.message : 'Failed to generate AI summary');
                  } finally {
                    setGeneratingSummary(false);
                  }
                }}
              >
                Generate
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  ), [appConfig.analytics.capabilities.crossRunAiSummary, appId, credentialsReady, generatingSummary, model, provider, refreshAnalytics, showModelPicker]);

  const isLoading = !entry || entry.status === 'loading';
  const subtitle = analytics
    ? `Updated ${analytics.metadata.computedAt ? new Date(analytics.metadata.computedAt).toLocaleString() : '—'}`
    : undefined;

  return (
    <PageSurface
      icon={pageIcon}
      title={pageTitle}
      subtitle={subtitle}
      actions={headerActions}
      showHeader={!isLoading}
    >
      {isLoading ? (
        <LoadingState />
      ) : !analytics ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics yet"
          description="Generate at least one report, then refresh cross-run analytics."
          className="w-full max-w-md"
          fill
        />
      ) : (
        <div className="space-y-6">
          {generatingSummary && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-info)]" />
              Generating AI summary...
            </div>
          )}

          {summary && <CrossRunSummaryCard summary={summary} />}

          {analytics.sections.map((section) => (
            <section key={section.id} className="space-y-4">
              <SectionHeader title={section.title} description={section.description ?? undefined} />
              <SectionContent section={section} />
            </section>
          ))}
        </div>
      )}
    </PageSurface>
  );
}
