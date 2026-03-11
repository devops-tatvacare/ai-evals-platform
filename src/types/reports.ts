// Report payload types — mirrors backend CamelModel output exactly.

// --- Health Score ---

export interface HealthScoreBreakdownItem {
  value: number;
  weighted: number;
}

export interface HealthScoreBreakdown {
  intentAccuracy: HealthScoreBreakdownItem;
  correctnessRate: HealthScoreBreakdownItem;
  efficiencyRate: HealthScoreBreakdownItem;
  taskCompletion: HealthScoreBreakdownItem;
}

export interface HealthScore {
  grade: string;
  numeric: number;
  breakdown: HealthScoreBreakdown;
}

// --- Verdict Distributions ---

export interface IntentHistogram {
  buckets: string[];
  counts: number[];
}

export interface VerdictDistributions {
  correctness: Record<string, number>;
  efficiency: Record<string, number>;
  adversarial: Record<string, number> | null;
  intentHistogram: IntentHistogram;
  customEvaluations?: Record<string, unknown>; // deprecated — kept for cache compat
}

// --- Rule Compliance ---

export interface RuleComplianceEntry {
  ruleId: string;
  section: string;
  passed: number;
  failed: number;
  rate: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface CoFailure {
  ruleA: string;
  ruleB: string;
  coOccurrenceRate: number;
}

export interface RuleComplianceMatrix {
  rules: RuleComplianceEntry[];
  coFailures: CoFailure[];
}

// --- Friction Analysis ---

export interface FrictionPattern {
  description: string;
  count: number;
  exampleThreadIds: string[];
}

export interface FrictionAnalysis {
  totalFrictionTurns: number;
  byCause: Record<string, number>;
  recoveryQuality: Record<string, number>;
  avgTurnsByVerdict: Record<string, number>;
  topPatterns: FrictionPattern[];
}

// --- Adversarial Breakdown ---

export interface AdversarialGoalResult {
  goal: string;
  passed: number;
  total: number;
  passRate: number;
}

export interface AdversarialDifficultyResult {
  difficulty: string;
  passed: number;
  total: number;
}

export interface AdversarialBreakdown {
  byGoal: AdversarialGoalResult[];
  byDifficulty: AdversarialDifficultyResult[];
}

// --- Exemplars ---

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RuleViolation {
  ruleId: string;
  evidence: string;
}

export interface ReportFrictionTurn {
  turn: number;
  cause: 'bot' | 'user';
  description: string;
}

export interface ExemplarThread {
  threadId: string;
  compositeScore: number;
  intentAccuracy: number | null;
  correctnessVerdict: string | null;
  efficiencyVerdict: string | null;
  taskCompleted: boolean;
  transcript: TranscriptMessage[];
  ruleViolations: RuleViolation[];
  frictionTurns: ReportFrictionTurn[];
  // Adversarial-specific fields (populated only for batch_adversarial exemplars)
  goalFlow?: string[];
  activeTraits?: string[];
  difficulty?: string;
  failureModes?: string[];
  reasoning?: string;
  goalAchieved?: boolean;
}

export interface Exemplars {
  best: ExemplarThread[];
  worst: ExemplarThread[];
}

// --- Production Prompts ---

export interface ProductionPrompts {
  intentClassification: string | null;
  mealSummarySpec: string | null;
}

// --- AI Narrative (populated in Phase 3) ---

export interface TopIssue {
  rank: number;
  area: string;
  description: string;
  affectedCount: number;
  exampleThreadId: string | null;
}

export interface ExemplarAnalysis {
  threadId: string;
  type: 'good' | 'bad';
  whatHappened: string;
  why: string;
  promptGap: string | null;
}

export interface PromptGap {
  promptSection: string;
  evalRule: string;
  gapType: 'UNDERSPEC' | 'SILENT' | 'LEAKAGE' | 'CONFLICTING';
  description: string;
  suggestedFix: string;
}

export interface Recommendation {
  priority: 'P0' | 'P1' | 'P2';
  area: string;
  action: string;
  estimatedImpact: string;
}

export interface NarrativeOutput {
  executiveSummary: string;
  topIssues: TopIssue[];
  exemplarAnalysis: ExemplarAnalysis[];
  promptGaps: PromptGap[];
  recommendations: Recommendation[];
}

// --- Custom Evaluations Report ---

export interface ThresholdPassRates {
  greenPct: number;
  yellowPct: number;
  redPct: number;
  greenThreshold: number;
  yellowThreshold: number | null;
}

export interface FieldAggregation {
  key: string;
  fieldType: 'number' | 'boolean' | 'enum' | 'text' | 'array';
  displayMode: 'header' | 'card';
  label: string;
  sampleCount: number;
  // Number fields
  average: number | null;
  thresholdPassRates: ThresholdPassRates | null;
  // Boolean fields
  passRate: number | null;
  trueCount: number | null;
  falseCount: number | null;
  // Enum fields
  distribution: Record<string, number> | null;
}

export interface EvaluatorSection {
  evaluatorId: string;
  evaluatorName: string;
  totalThreads: number;
  completed: number;
  errors: number;
  errorRate: number;
  primaryField: FieldAggregation | null;
  fields: FieldAggregation[];
}

export interface CustomEvalNarrativeFinding {
  finding: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedCount: number;
}

export interface CustomEvalNarrative {
  overallAssessment: string;
  keyFindings: CustomEvalNarrativeFinding[];
  notablePatterns: string[];
}

export interface CustomEvaluationsReport {
  evaluatorSections: EvaluatorSection[];
  narrative: CustomEvalNarrative | null;
}

// --- Top-level payload ---

export interface ReportMetadata {
  runId: string;
  runName: string | null;
  appId: string;
  evalType: string;
  createdAt: string;
  llmProvider: string | null;
  llmModel: string | null;
  narrativeModel: string | null;
  totalThreads: number;
  completedThreads: number;
  errorThreads: number;
  durationMs: number | null;
  dataPath: string | null;
}

export interface ReportPayload {
  metadata: ReportMetadata;
  healthScore: HealthScore;
  distributions: VerdictDistributions;
  ruleCompliance: RuleComplianceMatrix;
  friction: FrictionAnalysis;
  adversarial: AdversarialBreakdown | null;
  exemplars: Exemplars;
  productionPrompts: ProductionPrompts;
  narrative: NarrativeOutput | null;
  customEvaluationsReport: CustomEvaluationsReport | null;
}
