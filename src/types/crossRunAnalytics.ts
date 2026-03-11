/** Cross-run aggregate analytics types — mirrors backend cross_run_aggregator.py schemas. */

export interface RunSlice {
  runId: string;
  runName: string | null;
  evalType: string;
  createdAt: string;
  healthScore: number;
  grade: string;
  totalThreads: number;
}

export interface CrossRunStats {
  totalRuns: number;
  allRuns: number;
  totalThreads: number;
  totalAdversarialTests: number;
  avgHealthScore: number;
  avgGrade: string;
  avgBreakdown: Record<string, number>;
  adversarialPassRate: number | null;
}

export interface HealthTrendPoint {
  runId: string;
  runName: string | null;
  evalType: string;
  createdAt: string;
  healthScore: number;
  grade: string;
  breakdown: Record<string, number>;
}

export interface RuleHeatmapRow {
  ruleId: string;
  section: string;
  avgRate: number;
  worstSeverity: string;
  cells: (number | null)[];
}

export interface RuleComplianceHeatmap {
  runs: RunSlice[];
  rows: RuleHeatmapRow[];
}

export interface AdversarialHeatmapRow {
  goal: string;
  avgPassRate: number;
  cells: (number | null)[];
}

export interface AdversarialHeatmap {
  runs: RunSlice[];
  rows: AdversarialHeatmapRow[];
}

export interface AggregatedIssue {
  area: string;
  descriptions: string[];
  totalAffected: number;
  runCount: number;
  worstRank: number;
}

export interface AggregatedRecommendation {
  area: string;
  highestPriority: string;
  actions: string[];
  runCount: number;
  estimatedImpacts: string[];
}

export interface IssuesAndRecommendations {
  issues: AggregatedIssue[];
  recommendations: AggregatedRecommendation[];
  runsWithNarrative: number;
  runsWithoutNarrative: number;
}

export interface CrossRunAnalytics {
  stats: CrossRunStats;
  healthTrend: HealthTrendPoint[];
  ruleComplianceHeatmap: RuleComplianceHeatmap;
  adversarialHeatmap: AdversarialHeatmap | null;
  issuesAndRecommendations: IssuesAndRecommendations;
}

export interface CrossRunAISummary {
  executiveSummary: string;
  trendAnalysis: string;
  criticalPatterns: string[];
  strategicRecommendations: string[];
}

export interface CrossRunAISummaryRequest {
  appId: string;
  stats: Record<string, unknown>;
  healthTrend: Record<string, unknown>[];
  topIssues: Record<string, unknown>[];
  topRecommendations: Record<string, unknown>[];
  provider?: string;
  model?: string;
}

export interface CrossRunAnalyticsResponse {
  analytics: CrossRunAnalytics;
  computedAt: string;
  isStale: boolean;
  newRunsSince: number;
  sourceRunCount: number;
}
