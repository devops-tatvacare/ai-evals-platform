export interface PlatformRunNarrativeIssue {
  title: string;
  area: string;
  severity: string;
  summary: string;
}

export interface PlatformRunNarrativeRecommendation {
  priority: string;
  area: string;
  action: string;
  rationale: string;
}

export interface PlatformRunNarrativeExemplar {
  itemId: string;
  label: string;
  analysis: string;
}

export interface PlatformRunNarrativePromptGap {
  gapType: string;
  promptSection: string;
  evaluationRule: string;
  suggestedFix: string;
}

export interface PlatformRunNarrative {
  schemaVersion: 'v1';
  schemaKey: 'platform_run_narrative_v1';
  schemaOwner: 'backend';
  executiveSummary: string;
  issues: PlatformRunNarrativeIssue[];
  recommendations: PlatformRunNarrativeRecommendation[];
  exemplars: PlatformRunNarrativeExemplar[];
  promptGaps: PlatformRunNarrativePromptGap[];
}

export interface PlatformCrossRunNarrativePattern {
  title: string;
  summary: string;
  affectedRuns: number;
}

export interface PlatformCrossRunNarrativeRecommendation {
  priority: string;
  action: string;
  expectedImpact: string;
}

export interface PlatformCrossRunNarrative {
  schemaVersion: 'v1';
  schemaKey: 'platform_cross_run_narrative_v1';
  schemaOwner: 'backend';
  executiveSummary: string;
  trendAnalysis: string;
  criticalPatterns: PlatformCrossRunNarrativePattern[];
  strategicRecommendations: PlatformCrossRunNarrativeRecommendation[];
}

export interface PrintThemeTokenSet {
  accent: string;
  accentMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  background: string;
}

export interface PlatformDocumentBlockBase {
  id: string;
  title?: string | null;
}

export interface CoverBlock extends PlatformDocumentBlockBase {
  type: 'cover';
  subtitle?: string | null;
  metadata: Record<string, string>;
}

export interface StatGridItem {
  label: string;
  value: string;
  tone: string;
}

export interface StatGridBlock extends PlatformDocumentBlockBase {
  type: 'stat_grid';
  items: StatGridItem[];
}

export interface ProseBlock extends PlatformDocumentBlockBase {
  type: 'prose';
  body: string;
}

export interface TableColumn {
  key: string;
  label: string;
  align: 'left' | 'center' | 'right';
}

export interface TableBlock extends PlatformDocumentBlockBase {
  type: 'table';
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null>>;
}

export interface HeatmapCell {
  label: string;
  value: number | null;
  tone: string;
}

export interface HeatmapTableRow {
  label: string;
  cells: HeatmapCell[];
}

export interface HeatmapTableBlock extends PlatformDocumentBlockBase {
  type: 'heatmap_table';
  columns: string[];
  rows: HeatmapTableRow[];
}

export interface MetricBarItem {
  label: string;
  value: number;
  maxValue: number;
  tone: string;
}

export interface MetricBarListBlock extends PlatformDocumentBlockBase {
  type: 'metric_bar_list';
  items: MetricBarItem[];
}

export interface RecommendationListItem {
  priority: string;
  title: string;
  summary: string;
}

export interface RecommendationListBlock extends PlatformDocumentBlockBase {
  type: 'recommendation_list';
  items: RecommendationListItem[];
}

export interface EntityTableBlock extends PlatformDocumentBlockBase {
  type: 'entity_table';
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null>>;
}

export interface PageBreakBlock extends PlatformDocumentBlockBase {
  type: 'page_break';
}

export type PlatformDocumentBlock =
  | CoverBlock
  | StatGridBlock
  | ProseBlock
  | TableBlock
  | HeatmapTableBlock
  | MetricBarListBlock
  | RecommendationListBlock
  | EntityTableBlock
  | PageBreakBlock;

export interface PlatformReportDocument {
  schemaVersion: 'v1';
  title: string;
  subtitle: string | null;
  theme: PrintThemeTokenSet;
  blocks: PlatformDocumentBlock[];
}

export interface PlatformReportSectionBase {
  id: string;
  title: string;
  description?: string | null;
  variant: string;
}

export interface SummaryCard {
  key: string;
  label: string;
  value: string;
  tone: string;
  subtitle?: string | null;
}

export interface SummaryCardsSection extends PlatformReportSectionBase {
  type: 'summary_cards';
  data: SummaryCard[];
}

export interface NarrativeSection extends PlatformReportSectionBase {
  type: 'narrative';
  data: PlatformRunNarrative | PlatformCrossRunNarrative;
}

export interface MetricBar {
  key: string;
  label: string;
  value: number;
  maxValue: number;
  unit?: string | null;
  tone: string;
}

export interface MetricBreakdownSection extends PlatformReportSectionBase {
  type: 'metric_breakdown';
  data: MetricBar[];
}

export interface DistributionSeries {
  label: string;
  values: number[];
  categories: string[];
}

export interface DistributionChartSection extends PlatformReportSectionBase {
  type: 'distribution_chart';
  data: DistributionSeries[];
}

export interface ComplianceRow {
  key: string;
  label: string;
  section?: string | null;
  passed: number;
  failed: number;
  notEvaluated?: number | null;
  rate: number;
  severity?: string | null;
  total?: number | null;
}

export interface ComplianceCoFailure {
  ruleA: string;
  ruleB: string;
  coOccurrenceRate: number;
}

export interface ComplianceTableSection extends PlatformReportSectionBase {
  type: 'compliance_table';
  data: ComplianceRow[];
  coFailures?: ComplianceCoFailure[];
}

export interface PlatformFrictionPattern {
  description: string;
  count: number;
  exampleThreadIds: string[];
}

export interface FrictionAnalysisSection extends PlatformReportSectionBase {
  type: 'friction_analysis';
  data: {
    totalFrictionTurns: number;
    byCause: Record<string, number>;
    recoveryQuality: Record<string, number>;
    avgTurnsByVerdict: Record<string, number>;
    topPatterns: PlatformFrictionPattern[];
  };
}

export interface HeatmapPoint {
  label: string;
  value: number | null;
  tone: string;
  subtitle?: string | null;
}

export interface HeatmapRow {
  key: string;
  label: string;
  cells: HeatmapPoint[];
}

export interface HeatmapSection extends PlatformReportSectionBase {
  type: 'heatmap';
  data: {
    columns: string[];
    rows: HeatmapRow[];
  };
}

export interface EntitySlice {
  entityId: string;
  label: string;
  summary: Record<string, string | number>;
  details?: Record<string, string | number | boolean | null>;
}

export interface EntitySlicesSection extends PlatformReportSectionBase {
  type: 'entity_slices';
  data: EntitySlice[];
}

export interface FlagItem {
  key: string;
  label: string;
  relevant: number;
  present: number;
  notRelevant?: number | null;
  attempted?: number | null;
  accepted?: number | null;
}

export interface FlagsSection extends PlatformReportSectionBase {
  type: 'flags';
  data: FlagItem[];
}

export interface IssueItem {
  title: string;
  area: string;
  summary: string;
  priority: string;
  affectedCount?: number;
}

export interface RecommendationItem {
  priority: string;
  title: string;
  action: string;
  expectedImpact?: string;
}

export interface IssuesRecommendationsSection extends PlatformReportSectionBase {
  type: 'issues_recommendations';
  data: {
    issues: IssueItem[];
    recommendations: RecommendationItem[];
  };
}

export interface ExemplarItem {
  itemId: string;
  label: string;
  score?: number | null;
  summary: string;
  details?: Record<string, unknown>;
}

export interface ExemplarsSection extends PlatformReportSectionBase {
  type: 'exemplars';
  data: ExemplarItem[];
}

export interface PromptGapItem {
  gapType: string;
  promptSection: string;
  evaluationRule: string;
  summary: string;
  suggestedFix?: string | null;
}

export interface PromptGapAnalysisSection extends PlatformReportSectionBase {
  type: 'prompt_gap_analysis';
  data: PromptGapItem[];
}

export interface CalloutSection extends PlatformReportSectionBase {
  type: 'callout';
  data: {
    message: string;
    tone: string;
  };
}

export interface TrendChartPoint {
  bucket: string;
  hoverLabel?: string | null;
  primary: number;
  breakdown: Record<string, number>;
}

export interface TrendChartBreakdown {
  key: string;
  label: string;
}

export interface TrendChartSection extends PlatformReportSectionBase {
  type: 'trend_chart';
  data: {
    points: TrendChartPoint[];
    primaryLabel: string;
    primaryColor?: string | null;
    breakdowns: TrendChartBreakdown[];
    yDomain: [number, number];
    referenceValue?: number | null;
    referenceLabel?: string | null;
  };
}

export interface InsightPanelsItem {
  area: string;
  priority: string;
  runCount: number;
  items: { text: string; impacts: string[] }[];
  stats: { label: string; value: string; success: boolean }[];
  footerImpacts: string[];
}

export interface InsightPanelsSection extends PlatformReportSectionBase {
  type: 'insight_panels';
  data: InsightPanelsItem[];
}

export type PlatformReportSection =
  | SummaryCardsSection
  | NarrativeSection
  | MetricBreakdownSection
  | DistributionChartSection
  | ComplianceTableSection
  | FrictionAnalysisSection
  | HeatmapSection
  | EntitySlicesSection
  | FlagsSection
  | IssuesRecommendationsSection
  | ExemplarsSection
  | PromptGapAnalysisSection
  | CalloutSection
  | TrendChartSection
  | InsightPanelsSection;

/**
 * Phase 2 — narrative_status taxonomy mirror of NarrativeStatus in
 * backend/app/services/reports/contracts/run_report.py. Optional so older
 * cached artifacts (no key on disk) deserialize unchanged.
 */
export type NarrativeStatus =
  | 'disabled'
  | 'skipped_no_model'
  | 'completed'
  | 'failed';

export interface PlatformReportMetadata {
  appId: string;
  reportKind: 'single_run';
  reportId?: string | null;
  reportName?: string | null;
  reportRunId?: string | null;
  runId: string;
  runName: string | null;
  evalType: string;
  createdAt: string;
  computedAt: string;
  sourceRunCount: number;
  llmProvider: string | null;
  llmModel: string | null;
  narrativeModel: string | null;
  narrativeStatus?: NarrativeStatus | null;
  narrativeError?: string | null;
  cacheKey: string | null;
}

/**
 * Phase 2 — DataQualityReport mirror. Optional on the payload so older cached
 * artifacts deserialize. Renderer normalizes absent → `{ overall: 'complete',
 * missingInputs: [], sectionStatus: {} }`.
 */
export type DataQualityOverall = 'complete' | 'partial' | 'degraded';
export type DataQualitySectionStatus =
  | 'complete'
  | 'empty'
  | 'dropped_from_export';

export interface DataQualityReport {
  overall: DataQualityOverall;
  missingInputs: string[];
  sectionStatus: Record<string, DataQualitySectionStatus>;
}

export interface PlatformReportPresentation {
  sections: Array<{
    sectionId: string;
    componentId: string;
    title?: string | null;
    description?: string | null;
    variant: string;
    printable: boolean;
  }>;
  rendererId: string;
  layoutGroups: Array<Record<string, unknown>>;
  density: string;
  designTokens: Record<string, unknown>;
  themeTokens: Record<string, unknown>;
}

export interface PlatformRunReportPayload {
  schemaVersion: 'v1';
  metadata: PlatformReportMetadata;
  presentation: PlatformReportPresentation;
  sections: PlatformReportSection[];
  exportDocument: PlatformReportDocument;
  dataQuality?: DataQualityReport;
}

export interface PlatformCrossRunMetadata {
  appId: string;
  reportKind: 'cross_run';
  computedAt: string;
  sourceRunCount: number;
  totalRunsAvailable: number;
  cacheKey: string | null;
}

export interface PlatformCrossRunPayload {
  schemaVersion: 'v1';
  metadata: PlatformCrossRunMetadata;
  sections: PlatformReportSection[];
  exportDocument?: PlatformReportDocument | null;
}
