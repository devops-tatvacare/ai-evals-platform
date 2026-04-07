import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BarChart3, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { AppId, LLMProvider } from '@/types';
import type {
  EntityTableBlock,
  HeatmapTableBlock,
  IssuesRecommendationsSection,
  MetricBarListBlock,
  MetricBreakdownSection,
  NarrativeSection,
  PlatformDocumentBlock,
  PlatformReportDocument,
  PlatformCrossRunNarrative,
  PlatformCrossRunPayload,
  PlatformReportSection,
  PlatformRunNarrativeIssue,
  PlatformRunNarrativeRecommendation,
  RecommendationListBlock,
  StatGridBlock,
  SummaryCard,
  SummaryCardsSection,
  TableBlock,
  PlatformRunNarrative,
  PlatformRunReportPayload,
  ProseBlock,
  CoverBlock,
} from '@/types/platformReports';
import { Button, EmptyState, LLMConfigSection, Tabs } from '@/components/ui';
import { reportsApi } from '@/services/api/reportsApi';
import { useCrossRunStore, hasProviderCredentials, LLM_PROVIDERS, useLLMSettingsStore } from '@/stores';
import { notificationService } from '@/services/notifications';
import { useAppConfig } from '@/hooks';
import SectionHeader from '@/features/evalRuns/components/report/shared/SectionHeader';
import CalloutBox from '@/features/evalRuns/components/report/shared/CalloutBox';
import { cn } from '@/utils/cn';

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

function toneClass(tone: string): string {
  if (tone === 'positive' || tone === 'success') return 'text-[var(--color-success)]';
  if (tone === 'warning') return 'text-[var(--color-warning)]';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'text-[var(--color-error)]';
  return 'text-[var(--text-secondary)]';
}

function calloutVariant(tone: string): 'info' | 'success' | 'warning' | 'danger' {
  if (tone === 'positive' || tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'danger';
  return 'info';
}

function HeatCell({ tone, value }: { tone: string; value: number | null }) {
  const bg =
    tone === 'positive' || tone === 'success'
      ? 'bg-emerald-500/15'
      : tone === 'warning'
        ? 'bg-amber-500/15'
        : tone === 'negative' || tone === 'danger' || tone === 'error'
          ? 'bg-rose-500/15'
          : 'bg-[var(--bg-tertiary)]';
  return (
    <td className={cn('px-3 py-2 text-center text-xs border border-[var(--border-subtle)]', bg)}>
      {value == null ? '—' : value}
    </td>
  );
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

function blockToneClass(tone: string): string {
  if (tone === 'positive' || tone === 'success') return 'text-emerald-700';
  if (tone === 'warning') return 'text-amber-700';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'text-rose-700';
  return 'text-slate-600';
}

function blockToneSurface(tone: string): string {
  if (tone === 'positive' || tone === 'success') return 'bg-emerald-50';
  if (tone === 'warning') return 'bg-amber-50';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'bg-rose-50';
  return 'bg-slate-100';
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
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-white p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {block.items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="rounded-[18px] border border-[var(--report-doc-border)] bg-[var(--report-doc-background)] p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--report-doc-text-secondary)]">{item.label}</div>
            <div className={`mt-2 text-[30px] font-semibold leading-none ${blockToneClass(item.tone)}`}>{item.value}</div>
            <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${blockToneSurface(item.tone)} ${blockToneClass(item.tone)}`}>
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
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-white p-5 shadow-sm">
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
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-white p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {block.columns.map((column) => (
                <th
                  key={column.key}
                  className={`border-b border-[var(--report-doc-border)] px-3 py-3 text-xs uppercase tracking-[0.16em] text-[var(--report-doc-text-secondary)] ${
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                  }`}
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
                    className={`border-b border-[var(--report-doc-border)] px-3 py-3 text-sm text-[var(--report-doc-text-primary)] ${
                      column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                    }`}
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
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-white p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="border-b border-[var(--report-doc-border)] px-3 py-3 text-left text-xs uppercase tracking-[0.16em] text-[var(--report-doc-text-secondary)]">
                Metric
              </th>
              {block.columns.map((column) => (
                <th key={column} className="border-b border-[var(--report-doc-border)] px-3 py-3 text-center text-xs uppercase tracking-[0.16em] text-[var(--report-doc-text-secondary)]">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border-b border-[var(--report-doc-border)] px-3 py-3 text-sm font-medium text-[var(--report-doc-text-primary)]">
                  {row.label}
                </td>
                {row.cells.map((cell, cellIndex) => (
                  <td
                    key={`${row.label}-${cellIndex}`}
                    className={`border-b border-[var(--report-doc-border)] px-3 py-3 text-center text-sm ${blockToneSurface(cell.tone)} ${blockToneClass(cell.tone)}`}
                  >
                    {cell.value == null ? '—' : cell.value}
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

function ReportMetricBarBlockView({ block }: { block: MetricBarListBlock }) {
  return (
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-white p-5 shadow-sm">
      <PreviewBlockTitle title={block.title} />
      <div className="space-y-4">
        {block.items.map((item, index) => {
          const percent = item.maxValue > 0 ? Math.min(Math.max((item.value / item.maxValue) * 100, 0), 100) : 0;
          return (
            <div key={`${item.label}-${index}`}>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-[var(--report-doc-text-secondary)]">{item.label}</span>
                <span className={`font-semibold ${blockToneClass(item.tone)}`}>{item.value}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-200">
                <div
                  className="h-2.5 rounded-full"
                  style={{
                    width: `${percent}%`,
                    backgroundColor:
                      item.tone === 'positive' || item.tone === 'success'
                        ? 'var(--color-success)'
                        : item.tone === 'warning'
                          ? 'var(--color-warning)'
                          : item.tone === 'negative' || item.tone === 'danger' || item.tone === 'error'
                            ? 'var(--color-error)'
                            : 'var(--report-doc-accent)',
                  }}
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
    <section className="rounded-[22px] border border-[var(--report-doc-border)] bg-white p-5 shadow-sm">
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
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/95 p-3 shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
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

function SectionContent({ section }: { section: PlatformReportSection }) {
  if (section.type === 'summary_cards') {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {section.data.map((item) => (
          <div key={item.key} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.label}</div>
            <div className={cn('mt-2 text-2xl font-bold', toneClass(item.tone))}>{item.value}</div>
            {item.subtitle && <div className="mt-1 text-xs text-[var(--text-muted)]">{item.subtitle}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (section.type === 'narrative') {
    const narrative = section.data as PlatformRunNarrative | PlatformCrossRunNarrative;
    return (
      <div className="space-y-4">
        <CalloutBox variant="insight" title="Executive Summary">
          {narrative.executiveSummary}
        </CalloutBox>
        {'trendAnalysis' in narrative && narrative.trendAnalysis && (
          <CalloutBox variant="info" title="Trend Analysis">
            {narrative.trendAnalysis}
          </CalloutBox>
        )}
        {'issues' in narrative && narrative.issues.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {narrative.issues.map((issue) => (
              <div key={`${issue.area}-${issue.title}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{issue.area}</div>
                <div className="mt-1 font-semibold text-[var(--text-primary)]">{issue.title}</div>
                <div className="mt-2 text-sm text-[var(--text-secondary)]">{issue.summary}</div>
              </div>
            ))}
          </div>
        )}
        {'recommendations' in narrative && narrative.recommendations.length > 0 && (
          <div className="space-y-3">
            {narrative.recommendations.map((item, index) => {
              const rationale = 'rationale' in item && typeof item.rationale === 'string' ? item.rationale : null;
              const expectedImpact = 'expectedImpact' in item && typeof item.expectedImpact === 'string' ? item.expectedImpact : null;
              return (
                <div key={`${item.priority}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.priority}</div>
                  <div className="mt-1 text-sm text-[var(--text-primary)]">{item.action}</div>
                  {rationale && <div className="mt-1 text-sm text-[var(--text-secondary)]">{rationale}</div>}
                  {expectedImpact && <div className="mt-1 text-sm text-[var(--text-secondary)]">{expectedImpact}</div>}
                </div>
              );
            })}
          </div>
        )}
        {'criticalPatterns' in narrative && narrative.criticalPatterns.length > 0 && (
          <div className="space-y-3">
            {narrative.criticalPatterns.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <div className="font-semibold text-[var(--text-primary)]">{item.title}</div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">{item.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (section.type === 'metric_breakdown') {
    return (
      <div className="space-y-3">
        {section.data.map((item) => {
          const percent = item.maxValue > 0 ? Math.min(Math.max((item.value / item.maxValue) * 100, 0), 100) : 0;
          return (
            <div key={item.key}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-[var(--text-secondary)]">{item.label}</span>
                <span className={toneClass(item.tone)}>{item.value.toFixed(1)}{item.unit ?? ''}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--bg-tertiary)]">
                <div
                  className={cn(
                    'h-2 rounded-full',
                    item.tone === 'positive' || item.tone === 'success'
                      ? 'bg-emerald-500'
                      : item.tone === 'warning'
                        ? 'bg-amber-500'
                        : item.tone === 'negative' || item.tone === 'danger' || item.tone === 'error'
                          ? 'bg-rose-500'
                          : 'bg-[var(--color-info)]',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (section.type === 'distribution_chart') {
    return (
      <div className="space-y-4">
        {section.data.map((series) => (
          <div key={`${series.label}-${series.categories.join('-')}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="mb-3 font-semibold text-[var(--text-primary)]">{series.label}</div>
            <div className="space-y-2">
              {series.categories.map((category, index) => (
                <div key={`${series.label}-${category}`} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{category}</span>
                  <span className="font-medium text-[var(--text-primary)]">{series.values[index] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (section.type === 'compliance_table') {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">Rule</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Passed</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Failed</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Rate</th>
            </tr>
          </thead>
          <tbody>
            {section.data.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <td className="px-4 py-3 text-[var(--text-primary)]">{row.label}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{row.passed}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{row.failed}</td>
                <td className={cn('px-4 py-3 text-right font-medium', toneClass(row.rate >= 85 ? 'positive' : row.rate >= 60 ? 'warning' : 'negative'))}>
                  {row.rate.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (section.type === 'heatmap') {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">Metric</th>
              {section.data.columns.map((column) => (
                <th key={column} className="px-3 py-2 text-center text-xs uppercase tracking-wide text-[var(--text-muted)]">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.data.rows.map((row) => (
              <tr key={row.key}>
                <td className="px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-subtle)]">{row.label}</td>
                {row.cells.map((cell, index) => (
                  <HeatCell key={`${row.key}-${index}`} tone={cell.tone} value={cell.value} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (section.type === 'entity_slices') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {section.data.map((item) => (
          <div key={item.entityId} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="font-semibold text-[var(--text-primary)]">{item.label}</div>
            <dl className="mt-3 space-y-1">
              {Object.entries(item.summary).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-[var(--text-muted)]">{key}</dt>
                  <dd className="text-[var(--text-primary)]">{String(value)}</dd>
                </div>
              ))}
              {item.details && Object.entries(item.details).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-[var(--text-muted)]">{key}</dt>
                  <dd className="text-[var(--text-secondary)]">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    );
  }

  if (section.type === 'flags') {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">Flag</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Relevant</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Present</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Attempted</th>
              <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-[var(--text-muted)]">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {section.data.map((item) => (
              <tr key={item.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <td className="px-4 py-3 text-[var(--text-primary)]">{item.label}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{item.relevant}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{item.present}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{item.attempted ?? '—'}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{item.accepted ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (section.type === 'issues_recommendations') {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {section.data.issues.map((issue, index) => (
            <div key={`${issue.area}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{issue.priority}</div>
              <div className="mt-1 font-semibold text-[var(--text-primary)]">{issue.title}</div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">{issue.summary}</div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {section.data.recommendations.map((item, index) => (
            <div key={`${item.title}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.priority}</div>
              <div className="mt-1 font-semibold text-[var(--text-primary)]">{item.title}</div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">{item.action}</div>
              {item.expectedImpact && <div className="mt-1 text-sm text-[var(--text-muted)]">{item.expectedImpact}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section.type === 'exemplars') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {section.data.map((item) => (
          <div key={item.itemId} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="font-semibold text-[var(--text-primary)]">{item.label}</div>
              {item.score != null && <div className="text-sm text-[var(--text-secondary)]">{item.score.toFixed(1)}</div>}
            </div>
            <div className="mt-2 text-sm text-[var(--text-secondary)]">{item.summary}</div>
            {item.details && (
              <dl className="mt-3 space-y-1 text-sm">
                {Object.entries(item.details).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-muted)]">{key}</dt>
                    <dd className="text-[var(--text-primary)]">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (section.type === 'prompt_gap_analysis') {
    return (
      <div className="space-y-3">
        {section.data.map((item, index) => (
          <div key={`${item.gapType}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.gapType}</div>
            <div className="mt-1 text-sm text-[var(--text-primary)]">{item.summary}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {item.promptSection} · {item.evaluationRule}
            </div>
            {item.suggestedFix && <div className="mt-2 text-sm text-[var(--text-secondary)]">{item.suggestedFix}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (section.type === 'callout') {
    return (
      <CalloutBox variant={calloutVariant(section.data.tone)} title={section.title}>
        {section.data.message}
      </CalloutBox>
    );
  }

  return null;
}

function isRunNarrative(data: PlatformRunNarrative | PlatformCrossRunNarrative): data is PlatformRunNarrative {
  return 'issues' in data && 'recommendations' in data;
}

function getSectionByType<TType extends PlatformReportSection['type']>(
  report: PlatformRunReportPayload,
  type: TType,
): Extract<PlatformReportSection, { type: TType }> | null {
  const section = report.sections.find((candidate) => candidate.type === type);
  return (section as Extract<PlatformReportSection, { type: TType }> | undefined) ?? null;
}

function toneSurfaceClass(tone: string): string {
  if (tone === 'positive' || tone === 'success') return 'bg-emerald-500/12 text-emerald-300 border-emerald-400/20';
  if (tone === 'warning') return 'bg-amber-500/12 text-amber-300 border-amber-400/20';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'bg-rose-500/12 text-rose-300 border-rose-400/20';
  return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)]';
}

function priorityClass(priority: string | null | undefined): string {
  const normalized = (priority ?? '').trim().toUpperCase();
  if (normalized === 'P0' || normalized === 'CRITICAL' || normalized === 'HIGH') {
    return 'border-rose-400/30 bg-rose-500/12 text-rose-300';
  }
  if (normalized === 'P1' || normalized === 'MEDIUM') {
    return 'border-amber-400/30 bg-amber-500/12 text-amber-300';
  }
  return 'border-sky-400/30 bg-sky-500/12 text-sky-300';
}

function metricBarTone(tone: string): string {
  if (tone === 'positive' || tone === 'success') return 'var(--color-success)';
  if (tone === 'warning') return 'var(--color-warning)';
  if (tone === 'negative' || tone === 'danger' || tone === 'error') return 'var(--color-error)';
  return 'var(--color-brand-accent)';
}

function PlatformPrimaryMetricCard({ card }: { card: SummaryCard }) {
  return (
    <div className="min-w-[160px] rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        {card.label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
        {card.value}
      </div>
      {card.subtitle ? (
        <div className={cn('mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneSurfaceClass(card.tone))}>
          {card.subtitle}
        </div>
      ) : null}
    </div>
  );
}

function PlatformSummaryCardGrid({ cards }: { cards: SummaryCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.key}
          className="rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {card.label}
          </div>
          <div className="mt-2 text-2xl font-semibold leading-none text-[var(--text-primary)]">
            {card.value}
          </div>
          {(card.subtitle || card.tone) ? (
            <div className="mt-3 flex items-center gap-2">
              {card.subtitle ? (
                <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', toneSurfaceClass(card.tone))}>
                  {card.subtitle}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PlatformMetricBreakdown({ section }: { section: MetricBreakdownSection | null }) {
  if (!section || section.data.length === 0) return null;

  return (
    <section className="rounded-[22px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
      <SectionHeader title={section.title} description={section.description ?? undefined} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {section.data.map((metric) => {
          const percentage = metric.maxValue > 0 ? Math.max(0, Math.min(100, (metric.value / metric.maxValue) * 100)) : 0;
          const color = metricBarTone(metric.tone);
          return (
            <div key={metric.key} className="rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{metric.label}</div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    {metric.value}
                    {metric.unit ?? ''}
                    {metric.maxValue ? ` / ${metric.maxValue}${metric.unit ?? ''}` : ''}
                  </div>
                </div>
                <div className="text-sm font-semibold" style={{ color }}>
                  {Math.round(percentage)}%
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                <div className="h-full rounded-full" style={{ width: `${percentage}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlatformNarrativeSummary({
  narrativeSection,
  issuesSection,
}: {
  narrativeSection: NarrativeSection | null;
  issuesSection: IssuesRecommendationsSection | null;
}) {
  const narrative = narrativeSection && isRunNarrative(narrativeSection.data) ? narrativeSection.data : null;
  const issues: PlatformRunNarrativeIssue[] = issuesSection?.data.issues.length
    ? issuesSection.data.issues.map((item) => ({
        title: item.title,
        area: item.area,
        severity: item.priority,
        summary: item.summary,
      }))
    : (narrative?.issues ?? []);
  const recommendations: PlatformRunNarrativeRecommendation[] = issuesSection?.data.recommendations.length
    ? issuesSection.data.recommendations.map((item) => ({
        priority: item.priority,
        area: item.title,
        action: item.action,
        rationale: item.expectedImpact ?? '',
      }))
    : (narrative?.recommendations ?? []);

  if (!narrative && issues.length === 0 && recommendations.length === 0) return null;

  return (
    <section className="grid gap-6 xl:grid-cols-[1.25fr,0.75fr]">
      <div className="rounded-[22px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
        <SectionHeader
          title={narrativeSection?.title ?? 'Executive Summary'}
          description={narrativeSection?.description ?? 'Narrative summary for the selected report run.'}
        />
        <div className="mt-4 text-[15px] leading-7 text-[var(--text-secondary)]">
          {narrative?.executiveSummary ?? 'AI narrative was not generated for this report run.'}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[22px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
          <div className="text-sm font-semibold text-[var(--text-primary)]">Top Issues</div>
          <div className="mt-4 space-y-3">
            {issues.length > 0 ? issues.slice(0, 4).map((issue, index) => (
              <div key={`${issue.title}-${index}`} className="rounded-[16px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{issue.title}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{issue.area}</div>
                  </div>
                  <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', priorityClass(issue.severity))}>
                    {issue.severity}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{issue.summary}</p>
              </div>
            )) : (
              <div className="text-sm text-[var(--text-muted)]">No issue narratives are available for this run.</div>
            )}
          </div>
        </div>

        <div className="rounded-[22px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
          <div className="text-sm font-semibold text-[var(--text-primary)]">Recommendations</div>
          <div className="mt-4 space-y-3">
            {recommendations.length > 0 ? recommendations.slice(0, 4).map((item, index) => (
              <div key={`${item.action}-${index}`} className="rounded-[16px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{item.action}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{item.area}</div>
                  </div>
                  <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', priorityClass(item.priority))}>
                    {item.priority}
                  </span>
                </div>
                {item.rationale ? (
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{item.rationale}</p>
                ) : null}
              </div>
            )) : (
              <div className="text-sm text-[var(--text-muted)]">No recommendations are available for this run.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function PlatformReportView({ report, actions }: { report: PlatformRunReportPayload; actions: ReactNode }) {
  const [activeTab, setActiveTab] = useState('summary');
  const reportTitle = report.metadata.runName || report.metadata.reportName || 'Evaluation Report';
  const modelLabel = report.metadata.llmProvider && report.metadata.llmModel
    ? `${report.metadata.llmProvider} · ${report.metadata.llmModel}`
    : null;
  const hasRenderableSections = report.sections.length > 0;
  const summaryCardsSection = getSectionByType(report, 'summary_cards') as SummaryCardsSection | null;
  const metricSection = getSectionByType(report, 'metric_breakdown') as MetricBreakdownSection | null;
  const narrativeSection = getSectionByType(report, 'narrative') as NarrativeSection | null;
  const issuesSection = getSectionByType(report, 'issues_recommendations') as IssuesRecommendationsSection | null;
  const summaryCards = summaryCardsSection?.data ?? [];
  const primaryCard = summaryCards[0] ?? null;
  const secondaryCards = primaryCard ? summaryCards.slice(1) : summaryCards;

  return (
    <div className="space-y-6" style={buildReportPresentationStyle(report)}>
      <section className="rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
        <div className="flex flex-wrap items-start gap-4">
          {primaryCard ? <PlatformPrimaryMetricCard card={primaryCard} /> : null}

          <div className="min-w-0 flex-1">
            <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              {reportTitle}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-[var(--text-muted)]">
              <span>Generated {new Date(report.metadata.computedAt).toLocaleString()}</span>
              {report.metadata.evalType ? (
                <>
                  <span>·</span>
                  <span>{report.metadata.evalType}</span>
                </>
              ) : null}
              {modelLabel ? (
                <>
                  <span>·</span>
                  <span>{modelLabel}</span>
                </>
              ) : null}
            </div>
            {secondaryCards.length > 0 ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {secondaryCards.slice(0, 3).map((card) => (
                  <div key={card.key} className="rounded-[16px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3.5 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {card.label}
                    </div>
                    <div className="mt-2 text-lg font-semibold leading-none text-[var(--text-primary)]">
                      {card.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ml-auto shrink-0">{actions}</div>
        </div>
      </section>

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
                  <PlatformSummaryCardGrid cards={summaryCards} />
                  <PlatformMetricBreakdown section={metricSection} />
                  <PlatformNarrativeSummary narrativeSection={narrativeSection} issuesSection={issuesSection} />
                </div>
              ),
            },
            {
              id: 'detailed',
              label: 'Detailed Analysis',
              content: (
                <div className="space-y-6 pt-2">
                  {report.sections.map((section) => (
                    <section key={section.id} className="space-y-4 rounded-[22px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
                      <SectionHeader title={section.title} description={section.description ?? undefined} />
                      <SectionContent section={section} />
                    </section>
                  ))}
                </div>
              ),
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
      <CalloutBox variant="insight" title="AI Cross-Run Summary">
        {summary.executiveSummary}
      </CalloutBox>
      {summary.trendAnalysis && (
        <CalloutBox variant="info" title="Trend Analysis">
          {summary.trendAnalysis}
        </CalloutBox>
      )}
      {summary.criticalPatterns.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {summary.criticalPatterns.map((item, index) => (
            <div key={`${item.title}-${index}`} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <div className="font-semibold text-[var(--text-primary)]">{item.title}</div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">{item.summary}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlatformCrossRunDashboard({ appId }: { appId: AppId }) {
  const appConfig = useAppConfig(appId);
  const loadAnalytics = useCrossRunStore((s) => s.loadAnalytics);
  const refreshAnalytics = useCrossRunStore((s) => s.refreshAnalytics);
  const entry = useCrossRunStore((s) => s.entries[appId]);
  const analytics = entry?.data as PlatformCrossRunPayload | null | undefined;

  const [summary, setSummary] = useState<PlatformCrossRunNarrative | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [provider, setProvider] = useState<LLMProvider>(LLM_PROVIDERS[0].value);
  const [model, setModel] = useState('');

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
              <LLMConfigSection
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

  if (!entry || entry.status === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4">
        <EmptyState
          icon={BarChart3}
          title="No analytics yet"
          description="Generate at least one report, then refresh cross-run analytics."
          className="w-full max-w-md"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Updated {analytics.metadata.computedAt ? new Date(analytics.metadata.computedAt).toLocaleString() : '—'}
          </p>
        </div>
        {headerActions}
      </div>

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
  );
}
