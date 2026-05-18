/**
 * App Types & Metadata
 * Central definitions for multi-app support
 */

export type AppId = 'voice-rx' | 'kaira-bot' | 'inside-sales';
export const APP_IDS: AppId[] = ['voice-rx', 'kaira-bot', 'inside-sales'];

export function createAppRecord<T>(createValue: (appId: AppId) => T): Record<AppId, T> {
  return APP_IDS.reduce((record, appId) => {
    record[appId] = createValue(appId);
    return record;
  }, {} as Record<AppId, T>);
}

export interface AppSummary {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  iconUrl: string;
  isActive: boolean;
}

export interface AppMetadata {
  id: AppId;
  name: string;
  icon: string;
  description: string;
  searchPlaceholder: string;
  newItemLabel: string;
}

export interface AppVariableConfig {
  key: string;
  displayName: string;
  description: string;
  category: string;
}

export interface AppDynamicVariableSources {
  registry: boolean;
  listingApiPaths: boolean;
}

export interface AppFeaturesConfig {
  hasRules: boolean;
  hasRubricMode: boolean;
  hasCsvImport: boolean;
  hasAdversarial: boolean;
  hasTranscription: boolean;
  hasBatchEval: boolean;
  hasHumanReview: boolean;
  hasReviews: boolean;
  /** Workflow / campaign orchestration domain — drives whether `/logs`
   *  surfaces the workflow tabs and whether orchestration nav entries
   *  render. Per-app capability; the backend orchestration engine still
   *  gates execution by `ORCHESTRATION_DEFAULT_APP_ID`. */
  hasOrchestration: boolean;
}

export interface AppReviewsConfig {
  enabled: boolean;
  adapter: string;
  itemTypes: string[];
  defaultEntryPoint: string;
}

export interface AppRulesConfig {
  catalogSource: string;
  catalogKey: string;
  autoMatch: boolean;
}

export interface AppEvaluatorConfig {
  defaultVisibility: 'private' | 'shared';
  defaultModel: string;
  variables: AppVariableConfig[];
  dynamicVariableSources: AppDynamicVariableSources;
}

export interface AppAssetDefaults {
  evaluator: 'private' | 'shared';
  prompt: 'private' | 'shared';
  schema: 'private' | 'shared';
  adversarialContract: 'private' | 'shared';
}

export interface AppAssetPolicyConfig {
  shareable: boolean;
  sharingEnabled: boolean;
  latestVersionOnly: boolean;
  forkingEnabled: boolean;
  privateOnlyKeys: string[];
}

export interface AppAuthorizationAssetPolicies {
  evaluator: AppAssetPolicyConfig;
  prompt: AppAssetPolicyConfig;
  schema: AppAssetPolicyConfig;
  settings: AppAssetPolicyConfig;
}

export interface AppAuthorizationConfig {
  assetPolicies: AppAuthorizationAssetPolicies;
}

export interface AppEvalRunConfig {
  supportedTypes: string[];
}

export interface AppNavigationConfig {
  homePath: string;
  ownedPathPrefixes: string[];
  settingsPath: string | null;
  logsPath: string | null;
  runsPath: string | null;
  runDetailPath: string | null;
  threadDetailPath: string | null;
  evaluatorDetailPath: string | null;
  adversarialDetailPath: string | null;
  analyticsChartPath: string | null;
  analyticsDashboardPath: string | null;
  reportWizardPath: string | null;
}

export type AppActionRequirementSource = 'appSettings' | 'globalSettings' | 'tenantProviders';
export type AppActionRequirementValidation = 'nonEmpty' | 'truthy';

export interface AppActionRequirementConfig {
  source: AppActionRequirementSource;
  key: string;
  validation?: AppActionRequirementValidation;
  label?: string;
}

export interface AppPrimaryActionConfig {
  requirements: AppActionRequirementConfig[];
}

export interface AppActionsConfig {
  primaryNew: AppPrimaryActionConfig;
}

export interface AppCollectionFilterConfig {
  key: string;
  label: string;
  pillLabel?: string | null;
  control:
    | 'text'
    | 'multi-select'
    | 'segmented'
    | 'number-range'
    | 'toggle'
    /** Multi-select backed by a server suggestions endpoint. */
    | 'async-multi-select';
  fields?: string[];
  placeholder?: string;
  description?: string;
  optionSource?: 'agents';
  /** For `async-multi-select`: which suggestion field on the backend. */
  suggestionField?: 'lead_id' | 'phone' | 'rep_name' | 'city' | 'stage' | 'plan_name';
  /**
   * Manifest column this filter's value semantically represents. Used to
   * resolve the column's `unit` and `description` from `useCrmSchema` so the
   * UI can render units (e.g. "Duration (seconds)") and tooltips without
   * hardcoding either. When unset, lookup falls back to `suggestionField`,
   * `fields[0]`, then `key`.
   */
  manifestField?: string;
  options?: Array<{
    value: string;
    label: string;
  }>;
}

export interface AppCollectionEmptyStateConfig {
  title: string;
  description: string;
}

export interface AppCollectionDatasetConfig {
  filters: AppCollectionFilterConfig[];
  emptyState?: AppCollectionEmptyStateConfig;
}

export interface AppDrilldownFieldConfig {
  key: string;
  label: string;
  presentation?: 'text' | 'mono';
}

export interface AppDrilldownSectionConfig {
  id: string;
  title: string;
  fields: AppDrilldownFieldConfig[];
}

export interface AppDrilldownConfig {
  sections: AppDrilldownSectionConfig[];
}

export interface AppCollectionsConfig {
  datasets: Record<string, AppCollectionDatasetConfig>;
  drilldowns: Record<string, AppDrilldownConfig>;
}

export type AnalyticsSectionType =
  | 'summary_cards'
  | 'narrative'
  | 'metric_breakdown'
  | 'distribution_chart'
  | 'compliance_table'
  | 'friction_analysis'
  | 'heatmap'
  | 'entity_slices'
  | 'flags'
  | 'issues_recommendations'
  | 'exemplars'
  | 'prompt_gap_analysis'
  | 'callout';

export interface AnalyticsSectionConfig {
  id: string;
  type: AnalyticsSectionType;
  title: string | null;
  description: string | null;
  variant: string;
  printable: boolean;
}

export interface AnalyticsExportConfig {
  enabled: boolean;
  format: 'pdf';
  documentVariant: string;
  sectionIds: string[];
}

export interface AnalyticsSummaryConfig {
  enabled: boolean;
  sectionIds: string[];
}

export interface AnalyticsCapabilities {
  singleRunReport: boolean;
  crossRunAnalytics: boolean;
  crossRunAiSummary: boolean;
  pdfExport: boolean;
}

export interface AnalyticsCompositionConfig {
  sections: AnalyticsSectionConfig[];
  export: AnalyticsExportConfig;
  aiSummary: AnalyticsSummaryConfig;
}

export interface AnalyticsAssetKeys {
  promptReferencesKey: string | null;
  narrativeTemplateKey: string | null;
  glossaryKey: string | null;
}

export interface AppAnalyticsConfig {
  profile: string;
  capabilities: AnalyticsCapabilities;
  singleRun: AnalyticsCompositionConfig;
  crossRun: AnalyticsCompositionConfig;
  assets: AnalyticsAssetKeys;
  semanticModel?: Record<string, unknown> | null;
}

export type AppChatEntityMatch = 'exact' | 'prefix' | 'contains';

export interface AppChatDataSurfaceConfig {
  key: string;
  description: string;
  source: string;
  entityFieldMap?: Record<string, string>;
  fields?: string[];
  defaultLimit?: number;
}

export interface AppChatEntityResolverConfig {
  key: string;
  entityType: string;
  description?: string;
  source: string;
  field?: string | null;
  dimension?: string | null;
  match?: AppChatEntityMatch;
  limit?: number;
}

export interface AppChatConfig {
  enabled?: boolean;
  promptTemplates?: { label: string; prompt: string; category?: string }[];
  capabilities?: string[];
  dataSurfaces?: AppChatDataSurfaceConfig[];
  entityResolvers?: AppChatEntityResolverConfig[];
}

export type PageType =
  | 'runs'
  | 'runDetail'
  | 'threadDetail'
  | 'adversarialDetail'
  | 'evaluators'
  | 'evaluatorDetail'
  | 'logs'
  | 'analytics'
  | 'analyticsChart'
  | 'analyticsDashboard'
  | 'settings'
  | 'tags'
  | 'listing'
  | 'listingDetail'
  | 'callDetail'
  | 'leadDetail'
  | 'cost'
  | 'scheduledJobs'
  | 'adminUsers'
  | 'sherlock'
  | 'campaigns'
  | 'connections'
  | 'datasets'
  | 'datasetDetail'
  | 'chat';

export interface PageActionSpec {
  /** Stable id for telemetry. */
  id: string;
  /** Handler key — registry entry in `src/features/pageActions/registry.ts` maps this to a React component. */
  kind: string;
  /** Config passed to the action component (kind-specific). */
  config?: Record<string, unknown>;
  /** Permission gate. Optional — unset means visible to all. */
  requires?: string;
}

/** Sidebar quick-action spec.
 *
 *  Fully data-driven — `label` / `description` / `icon` / `requirements` all
 *  live on the spec, so a tenant can add a menu item by writing a config row
 *  with no code changes. The `kind` resolves to one of a small set of GENERIC
 *  primitive handlers in `QUICK_ACTION_REGISTRY` (today: openModal,
 *  triggerImperative, navigateTo). New behaviors are added by registering a
 *  new imperative trigger from the relevant feature module — never by adding
 *  an app-coupled kind to the registry.
 */
export interface QuickActionSpec {
  /** Stable id for telemetry. */
  id: string;
  /** Generic primitive kind. */
  kind: 'openModal' | 'triggerImperative' | 'navigateTo';
  /** Display label shown in the menu row. */
  label: string;
  /** Sub-text shown under the label. Optional. */
  description?: string;
  /** Lucide icon name (e.g. ``"MessageSquare"``). Resolved via the icon map
   *  in ``src/features/quickActions/iconMap.ts``. Missing / unknown names
   *  fall back to a neutral `Plus` glyph. */
  icon?: string;
  /** Kind-specific payload (`{modalId}`, `{triggerKey}`, `{path}`). */
  config?: Record<string, unknown>;
  /** Permission gate. Optional — unset means visible to all. */
  requires?: string;
  /** Per-spec runtime gates evaluated by ``evaluateActionAvailability``. */
  requirements?: AppActionRequirementConfig[];
}

export type EvaluatorDetailBandColor = 'emerald' | 'blue' | 'amber' | 'red';

export interface EvaluatorDetailBand {
  color: EvaluatorDetailBandColor;
  label: string;
  range: string;
  description: string;
}

export interface EvaluatorDetailConfig {
  /** Ordered interpretation bands rendered in the Compliance & Thresholds tab. Empty = hide section. */
  interpretationBands: EvaluatorDetailBand[];
}

export interface AppRunDetailReportTabConfig {
  enabled: boolean;
  /** Restrict the Report tab to a subset of `evalTypes`; omit = all. */
  enabledForEvalTypes?: string[];
}

export interface AppRunDetailDrilldownConfig {
  paramName: string;
  route: string;
  backLabel: string;
}

export interface AppRunDetailExtrasConfig {
  review?: boolean;
  adversarialAxes?: boolean;
  rawPayload?: boolean;
  historyTab?: boolean;
  drilldown?: AppRunDetailDrilldownConfig;
}

export interface AppRunDetailBehaviourConfig {
  hideTabsWhileActive?: boolean;
  bannerOnlyOnFailed?: boolean;
  failureHeadlineFromResult?: boolean;
}

/** Run shape selects the dispatcher path inside `useRunDetail`.
 *  - `single` — one `EvalRun` row, optional call drilldown (voice-rx, inside-sales).
 *  - `batch`  — one `Run` row with thread + adversarial sub-rows (kaira). */
export type RunShape = 'single' | 'batch';

export interface AppRunDetailConfig {
  /** Dispatches which run-detail hook drives the surface. */
  runShape: RunShape;
  /** Eval types this app produces. Drives the result-renderer registry lookup. */
  evalTypes: string[];
  reportTab: AppRunDetailReportTabConfig;
  extras: AppRunDetailExtrasConfig;
  behaviour: AppRunDetailBehaviourConfig;
}

export interface AppConfig {
  displayName: string;
  icon: string;
  description: string;
  features: AppFeaturesConfig;
  reviews: AppReviewsConfig;
  rules: AppRulesConfig;
  evaluator: AppEvaluatorConfig;
  assetDefaults: AppAssetDefaults;
  authorization: AppAuthorizationConfig;
  evalRun: AppEvalRunConfig;
  navigation: AppNavigationConfig;
  actions: AppActionsConfig;
  collections: AppCollectionsConfig;
  analytics: AppAnalyticsConfig;
  chat: AppChatConfig;
  /** Per-app override of PAGE_METADATA icons. Lucide icon referenced by name. Missing keys fall through to PAGE_METADATA. */
  pageIcons?: Partial<Record<PageType, string>>;
  /** Per-app override of page titles (only used where PAGE_METADATA title is non-empty). */
  pageTitles?: Partial<Record<PageType, string>>;
  /** Per-app extra header actions keyed by page type. Resolved via `PAGE_ACTION_COMPONENTS` registry. */
  pageActions?: Partial<Record<PageType, PageActionSpec[]>>;
  /** Per-app sidebar primary-action menu items. Resolved via `QUICK_ACTION_REGISTRY`.
   *  Empty / missing = no Run button is rendered. Order is preserved. */
  quickActions?: QuickActionSpec[];
  /** Per-app copy/labels for the shared evaluator-detail page. Missing = neutral default. */
  evaluatorDetail?: EvaluatorDetailConfig;
  /** Per-app run-detail surface config. Drives result-renderer dispatch, report-tab
   *  gating, drilldown sub-route, and chrome behaviour flags. Required after Phase 3
   *  for any app that mounts the run-detail page. */
  runDetail?: AppRunDetailConfig;
}

export interface RuleCatalogEntry {
  ruleId: string;
  ruleText: string;
  section: string;
  tags: string[];
  goalIds: string[];
  evaluationScopes: string[];
  [key: string]: unknown;
}

export interface RuleCatalogResponse {
  rules: RuleCatalogEntry[];
}

export const APPS: Record<AppId, AppMetadata> = {
  'voice-rx': {
    id: 'voice-rx',
    name: 'Voice Rx',
    icon: '/voice-rx-icon.jpeg',
    description: 'Audio file evaluation tool',
    searchPlaceholder: 'Search evaluations...',
    newItemLabel: 'New',
  },
  'kaira-bot': {
    id: 'kaira-bot',
    name: 'Kaira Bot',
    icon: '/kaira-icon.svg',
    description: 'Health chat bot assistant',
    searchPlaceholder: 'Search chats...',
    newItemLabel: 'New Chat',
  },
  'inside-sales': {
    id: 'inside-sales',
    name: 'Inside Sales',
    icon: '/inside-sales-icon.svg',
    description: 'Inside sales call quality evaluation',
    searchPlaceholder: 'Search calls...',
    newItemLabel: 'New Run',
  },
};

export const DEFAULT_APP: AppId = 'voice-rx';

const DEFAULT_ASSET_POLICY_CONFIG: AppAssetPolicyConfig = {
  shareable: true,
  sharingEnabled: true,
  latestVersionOnly: false,
  forkingEnabled: true,
  privateOnlyKeys: [],
};

const DEFAULT_APP_AUTHORIZATION_CONFIG: AppAuthorizationConfig = {
  assetPolicies: {
    evaluator: DEFAULT_ASSET_POLICY_CONFIG,
    prompt: DEFAULT_ASSET_POLICY_CONFIG,
    schema: DEFAULT_ASSET_POLICY_CONFIG,
    settings: DEFAULT_ASSET_POLICY_CONFIG,
  },
};

const DEFAULT_APP_ACTIONS_CONFIG: AppActionsConfig = {
  primaryNew: {
    requirements: [],
  },
};

const DEFAULT_APP_COLLECTIONS_CONFIG: AppCollectionsConfig = {
  datasets: {},
  drilldowns: {},
};

export const APP_CONFIG_FALLBACKS: Record<AppId, AppConfig> = {
  'voice-rx': {
    displayName: APPS['voice-rx'].name,
    icon: APPS['voice-rx'].icon,
    description: APPS['voice-rx'].description,
    features: {
      hasRules: false,
      hasRubricMode: false,
      hasCsvImport: false,
      hasAdversarial: false,
      hasTranscription: true,
      hasBatchEval: false,
      hasHumanReview: false,
      hasReviews: true,
      hasOrchestration: false,
    },
    reviews: {
      enabled: true,
      adapter: 'voice-rx-run',
      itemTypes: ['segment', 'field'],
      defaultEntryPoint: 'run_detail',
    },
    rules: {
      catalogSource: 'settings',
      catalogKey: 'rule-catalog',
      autoMatch: false,
    },
    evaluator: {
      defaultVisibility: 'private',
      defaultModel: '',
      variables: [],
      dynamicVariableSources: {
        registry: true,
        listingApiPaths: true,
      },
    },
    assetDefaults: {
      evaluator: 'private',
      prompt: 'private',
      schema: 'private',
      adversarialContract: 'private',
    },
    authorization: DEFAULT_APP_AUTHORIZATION_CONFIG,
    evalRun: {
      supportedTypes: [],
    },
    navigation: {
      homePath: '/',
      ownedPathPrefixes: ['/listing', '/runs', '/logs', '/settings', '/evaluators'],
      settingsPath: '/settings',
      logsPath: '/logs',
      runsPath: '/runs',
      runDetailPath: '/runs/:runId',
      threadDetailPath: null,
      evaluatorDetailPath: null,
      adversarialDetailPath: null,
      analyticsChartPath: '/analytics/charts/:chartId',
      analyticsDashboardPath: '/analytics/dashboards/:dashboardId',
      reportWizardPath: '/reports/generate',
    },
    actions: DEFAULT_APP_ACTIONS_CONFIG,
    collections: DEFAULT_APP_COLLECTIONS_CONFIG,
    analytics: {
      profile: 'voice_rx_v1',
      capabilities: {
        singleRunReport: true,
        crossRunAnalytics: true,
        crossRunAiSummary: true,
        pdfExport: true,
      },
      singleRun: {
        sections: [
          { id: 'voice-rx-summary', type: 'summary_cards', title: 'Accuracy Summary', description: null, variant: 'voice_rx_overview', printable: true },
          { id: 'voice-rx-overview', type: 'callout', title: 'Run Overview', description: null, variant: 'voice_rx_callout', printable: true },
          { id: 'voice-rx-metrics', type: 'metric_breakdown', title: 'Accuracy Metrics', description: null, variant: 'voice_rx_metrics', printable: true },
          { id: 'voice-rx-severity', type: 'distribution_chart', title: 'Severity Distribution', description: null, variant: 'voice_rx_severity', printable: true },
          { id: 'voice-rx-exemplars', type: 'exemplars', title: 'Discrepancy Examples', description: null, variant: 'voice_rx_examples', printable: true },
          { id: 'voice-rx-issues', type: 'issues_recommendations', title: 'Issues and Recommendations', description: null, variant: 'voice_rx_actions', printable: true },
        ],
        export: {
          enabled: true,
          format: 'pdf',
          documentVariant: 'voice-rx-run-v1',
          sectionIds: [
            'voice-rx-summary',
            'voice-rx-overview',
            'voice-rx-metrics',
            'voice-rx-severity',
            'voice-rx-exemplars',
            'voice-rx-issues',
          ],
        },
        aiSummary: {
          enabled: true,
          sectionIds: ['voice-rx-overview', 'voice-rx-exemplars', 'voice-rx-issues'],
        },
      },
      crossRun: {
        sections: [
          { id: 'voice-rx-cross-summary', type: 'summary_cards', title: 'Cross-Run Summary', description: null, variant: 'voice_rx_cross_run', printable: true },
          { id: 'voice-rx-cross-metrics', type: 'metric_breakdown', title: 'Accuracy Trends', description: null, variant: 'voice_rx_trends', printable: true },
          { id: 'voice-rx-cross-severity', type: 'heatmap', title: 'Severity Heatmap', description: null, variant: 'voice_rx_heatmap', printable: true },
          { id: 'voice-rx-cross-issues', type: 'issues_recommendations', title: 'Recurring Issues', description: null, variant: 'voice_rx_recurring', printable: true },
        ],
        export: {
          enabled: false,
          format: 'pdf',
          documentVariant: 'voice-rx-cross-run-v1',
          sectionIds: [],
        },
        aiSummary: {
          enabled: true,
          sectionIds: ['voice-rx-cross-summary', 'voice-rx-cross-severity', 'voice-rx-cross-issues'],
        },
      },
      assets: {
        promptReferencesKey: null,
        narrativeTemplateKey: null,
        glossaryKey: 'voice-rx-report-glossary',
      },
    },
    chat: {
      enabled: true,
      promptTemplates: [
        { label: 'Analyze latest run', prompt: 'Analyze the most recent evaluation run and summarize key findings' },
        { label: 'Compare accuracy trends', prompt: 'Compare accuracy trends across recent evaluation runs' },
        { label: 'Find top issues', prompt: 'What are the most common discrepancy patterns found in evaluations?' },
      ],
      capabilities: ['analytics', 'report_builder'],
      dataSurfaces: [],
      entityResolvers: [],
    },
    pageIcons: {},
    pageTitles: {},
    pageActions: {},
    quickActions: [
      {
        id: 'voice-rx-upload',
        kind: 'triggerImperative',
        label: 'Evaluation',
        description: 'Single audio file evaluation',
        icon: 'FileAudio',
        config: { triggerKey: 'voiceRxUpload' },
      },
    ],
    evaluatorDetail: { interpretationBands: [] },
    runDetail: {
      runShape: 'single',
      evalTypes: ['full_evaluation', 'custom'],
      reportTab: { enabled: true, enabledForEvalTypes: ['full_evaluation'] },
      extras: { rawPayload: true },
      behaviour: { failureHeadlineFromResult: true },
    },
  },
  'kaira-bot': {
    displayName: APPS['kaira-bot'].name,
    icon: APPS['kaira-bot'].icon,
    description: APPS['kaira-bot'].description,
    features: {
      hasRules: true,
      hasRubricMode: false,
      hasCsvImport: false,
      hasAdversarial: true,
      hasTranscription: false,
      hasBatchEval: true,
      hasHumanReview: false,
      hasReviews: true,
      hasOrchestration: false,
    },
    reviews: {
      enabled: true,
      adapter: 'thread-run',
      itemTypes: ['thread'],
      defaultEntryPoint: 'run_detail',
    },
    rules: {
      catalogSource: 'settings',
      catalogKey: 'adversarial-config',
      autoMatch: true,
    },
    evaluator: {
      defaultVisibility: 'private',
      defaultModel: '',
      variables: [],
      dynamicVariableSources: {
        registry: true,
        listingApiPaths: false,
      },
    },
    assetDefaults: {
      evaluator: 'private',
      prompt: 'private',
      schema: 'private',
      adversarialContract: 'shared',
    },
    authorization: DEFAULT_APP_AUTHORIZATION_CONFIG,
    evalRun: {
      supportedTypes: [],
    },
    navigation: {
      homePath: '/kaira',
      ownedPathPrefixes: ['/kaira'],
      settingsPath: '/kaira/settings',
      logsPath: '/kaira/logs',
      runsPath: '/kaira/runs',
      runDetailPath: '/kaira/runs/:runId',
      threadDetailPath: '/kaira/threads/:threadId',
      evaluatorDetailPath: null,
      adversarialDetailPath: '/kaira/runs/:runId/adversarial/:evalId',
      analyticsChartPath: '/kaira/analytics/charts/:chartId',
      analyticsDashboardPath: '/kaira/analytics/dashboards/:dashboardId',
      reportWizardPath: '/kaira/reports/generate',
    },
    actions: {
      primaryNew: {
        requirements: [
          {
            source: 'appSettings',
            key: 'kairaChatUserId',
          },
        ],
      },
    },
    collections: DEFAULT_APP_COLLECTIONS_CONFIG,
    analytics: {
      profile: 'kaira_v1',
      capabilities: {
        singleRunReport: true,
        crossRunAnalytics: true,
        crossRunAiSummary: true,
        pdfExport: true,
      },
      singleRun: {
        sections: [],
        export: {
          enabled: true,
          format: 'pdf',
          documentVariant: 'kaira-run-v1',
          sectionIds: [],
        },
        aiSummary: {
          enabled: true,
          sectionIds: [],
        },
      },
      crossRun: {
        sections: [],
        export: {
          enabled: false,
          format: 'pdf',
          documentVariant: 'kaira-cross-run-v1',
          sectionIds: [],
        },
        aiSummary: {
          enabled: true,
          sectionIds: [],
        },
      },
      assets: {
        promptReferencesKey: 'report-prompt-references',
        narrativeTemplateKey: 'report-narrative-template',
        glossaryKey: 'report-glossary',
      },
    },
    chat: {
      enabled: true,
      promptTemplates: [
        { label: 'Summarize evaluations', prompt: 'Summarize the latest evaluation results and highlight any failures' },
        { label: 'Build a report', prompt: 'Build a detailed report from the most recent evaluation run' },
        { label: 'Check rule violations', prompt: 'Which rules were most frequently violated across recent evaluations?' },
      ],
      capabilities: ['analytics', 'report_builder'],
      dataSurfaces: [],
      entityResolvers: [],
    },
    pageIcons: {},
    pageTitles: {},
    pageActions: {},
    quickActions: [
      {
        id: 'kaira-new-chat',
        kind: 'triggerImperative',
        label: 'New Chat',
        description: 'Start a new Kaira conversation',
        icon: 'MessageSquare',
        config: { triggerKey: 'kaira.createSession' },
        requirements: [
          { source: 'appSettings', key: 'kairaChatUserId' },
        ],
      },
      {
        id: 'kaira-batch-eval',
        kind: 'openModal',
        label: 'Batch Evaluation',
        description: 'Evaluate threads from CSV data',
        icon: 'FileSpreadsheet',
        config: { modalId: 'batchEval' },
      },
      {
        id: 'kaira-adversarial',
        kind: 'openModal',
        label: 'Adversarial Test',
        description: 'Run adversarial inputs against Kaira',
        icon: 'ShieldAlert',
        config: { modalId: 'adversarialTest' },
      },
    ],
    evaluatorDetail: { interpretationBands: [] },
    runDetail: {
      runShape: 'batch',
      evalTypes: ['batch_thread', 'batch_adversarial'],
      reportTab: { enabled: true },
      extras: { review: true, adversarialAxes: true, historyTab: true },
      behaviour: { hideTabsWhileActive: true },
    },
  },
  'inside-sales': {
    displayName: APPS['inside-sales'].name,
    icon: APPS['inside-sales'].icon,
    description: APPS['inside-sales'].description,
    features: {
      hasRules: false,
      hasRubricMode: true,
      hasCsvImport: true,
      hasAdversarial: false,
      hasTranscription: true,
      hasBatchEval: true,
      hasHumanReview: false,
      hasReviews: true,
      hasOrchestration: true,
    },
    reviews: {
      enabled: true,
      adapter: 'call-run',
      itemTypes: ['call'],
      defaultEntryPoint: 'run_detail',
    },
    rules: {
      catalogSource: 'settings',
      catalogKey: 'rule-catalog',
      autoMatch: false,
    },
    evaluator: {
      defaultVisibility: 'private',
      defaultModel: '',
      variables: [],
      dynamicVariableSources: {
        registry: true,
        listingApiPaths: false,
      },
    },
    assetDefaults: {
      evaluator: 'private',
      prompt: 'private',
      schema: 'private',
      adversarialContract: 'private',
    },
    authorization: DEFAULT_APP_AUTHORIZATION_CONFIG,
    evalRun: {
      supportedTypes: [],
    },
    navigation: {
      homePath: '/inside-sales',
      ownedPathPrefixes: ['/inside-sales'],
      settingsPath: '/inside-sales/settings',
      logsPath: '/inside-sales/logs',
      runsPath: '/inside-sales/runs',
      runDetailPath: '/inside-sales/runs/:runId',
      threadDetailPath: '/inside-sales/runs/:runId/calls/:threadId',
      evaluatorDetailPath: '/inside-sales/evaluators/:id',
      adversarialDetailPath: null,
      analyticsChartPath: '/inside-sales/analytics/charts/:chartId',
      analyticsDashboardPath: '/inside-sales/analytics/dashboards/:dashboardId',
      reportWizardPath: '/inside-sales/reports/generate',
    },
    actions: DEFAULT_APP_ACTIONS_CONFIG,
    collections: {
      datasets: {
        leads: {
          filters: [
            {
              key: 'leadId',
              label: 'Lead ID',
              pillLabel: 'Lead',
              control: 'async-multi-select',
              fields: ['leadId'],
              suggestionField: 'lead_id',
              placeholder: 'Type to search lead IDs...',
            },
            {
              key: 'phone',
              label: 'Mobile Number',
              pillLabel: 'Mobile',
              control: 'async-multi-select',
              fields: ['phone'],
              suggestionField: 'phone',
              placeholder: 'Type to search mobiles (e.g. 98xxx)...',
            },
            {
              key: 'stage',
              label: 'Stage',
              control: 'async-multi-select',
              fields: ['stage'],
              suggestionField: 'stage',
              placeholder: 'Type to search stages...',
            },
            {
              key: 'mqlMin',
              label: 'MQL Score',
              pillLabel: 'MQL',
              control: 'segmented',
              fields: ['mqlMin'],
              options: [
                { value: '', label: 'Any' },
                { value: '3', label: '>= 3' },
                { value: '5', label: '= 5 (MQL)' },
              ],
            },
            {
              key: 'condition',
              label: 'Condition',
              control: 'multi-select',
              fields: ['condition'],
              options: [
                { value: 'Diabetes', label: 'Diabetes' },
                { value: 'PCOS', label: 'PCOS' },
                { value: 'Fatty Liver', label: 'Fatty Liver' },
                { value: 'Obesity', label: 'Obesity' },
                { value: 'Hypertension', label: 'Hypertension' },
              ],
            },
            {
              key: 'city',
              label: 'City',
              control: 'async-multi-select',
              fields: ['city'],
              suggestionField: 'city',
              placeholder: 'Type to search cities...',
            },
            {
              key: 'agents',
              label: 'Rep',
              pillLabel: 'Rep',
              control: 'async-multi-select',
              fields: ['agents'],
              suggestionField: 'rep_name',
              placeholder: 'Type to search reps...',
            },
            {
              key: 'planName',
              label: 'Plan',
              pillLabel: 'Plan',
              control: 'async-multi-select',
              fields: ['planName'],
              suggestionField: 'plan_name',
              placeholder: 'Type to search plans...',
            },
          ],
          emptyState: {
            title: 'No leads found',
            description: 'No leads for the selected date range and filters.',
          },
        },
        calls: {
          filters: [
            {
              key: 'agents',
              label: 'Rep',
              pillLabel: 'Rep',
              control: 'async-multi-select',
              fields: ['agents'],
              suggestionField: 'rep_name',
              placeholder: 'Type to search reps...',
            },
            {
              key: 'leadId',
              label: 'Lead ID',
              pillLabel: 'Lead',
              control: 'async-multi-select',
              fields: ['leadId'],
              suggestionField: 'lead_id',
              placeholder: 'Type to search lead IDs...',
            },
            {
              key: 'direction',
              label: 'Direction',
              pillLabel: 'Dir',
              control: 'segmented',
              fields: ['direction'],
              options: [
                { value: '', label: 'All' },
                { value: 'inbound', label: 'Inbound' },
                { value: 'outbound', label: 'Outbound' },
              ],
            },
            {
              key: 'status',
              label: 'Call Status',
              pillLabel: 'Status',
              control: 'segmented',
              fields: ['status'],
              options: [
                { value: '', label: 'All' },
                { value: 'answered', label: 'Answered' },
                { value: 'not answered', label: 'Missed' },
              ],
            },
            { key: 'duration', label: 'Duration', control: 'number-range', fields: ['durationMin', 'durationMax'], manifestField: 'duration_seconds' },
            { key: 'eventCodes', label: 'Event Codes', pillLabel: 'Events', control: 'text', fields: ['eventCodes'], placeholder: 'e.g. 21,22' },
            {
              key: 'hasRecording',
              label: 'Recording',
              pillLabel: 'Recording',
              control: 'toggle',
              fields: ['hasRecording'],
              description: 'Only include calls with audio available',
            },
          ],
          emptyState: {
            title: 'No calls found',
            description: 'No call activities for the selected date range and filters.',
          },
        },
      },
      drilldowns: {
        lead: {
          sections: [
            {
              id: 'contact-source',
              title: 'Contact & Source',
              fields: [
                { key: 'phone', label: 'Phone', presentation: 'mono' },
                { key: 'email', label: 'Email' },
                { key: 'city', label: 'City' },
                { key: 'ageGroup', label: 'Age Group' },
                { key: 'source', label: 'Source' },
                { key: 'repName', label: 'Rep' },
                { key: 'createdOn', label: 'Lead Created' },
              ],
            },
            {
              id: 'health-profile',
              title: 'Health Profile',
              fields: [
                { key: 'condition', label: 'Condition' },
                { key: 'hba1cBand', label: 'HbA1c' },
                { key: 'bloodSugarBand', label: 'Blood Sugar' },
                { key: 'diabetesDuration', label: 'Diabetes Duration' },
                { key: 'currentManagement', label: 'Current Management' },
                { key: 'goal', label: 'Goal' },
                { key: 'intentToPay', label: 'Intent to Pay' },
                { key: 'preferredCallTime', label: 'Preferred Call Time' },
              ],
            },
          ],
        },
      },
    },
    analytics: {
      profile: 'inside_sales_v1',
      capabilities: {
        singleRunReport: true,
        crossRunAnalytics: true,
        crossRunAiSummary: true,
        pdfExport: true,
      },
      singleRun: {
        sections: [],
        export: {
          enabled: true,
          format: 'pdf',
          documentVariant: 'inside-sales-run-v1',
          sectionIds: [],
        },
        aiSummary: {
          enabled: true,
          sectionIds: [],
        },
      },
      crossRun: {
        sections: [],
        export: {
          enabled: false,
          format: 'pdf',
          documentVariant: 'inside-sales-cross-run-v1',
          sectionIds: [],
        },
        aiSummary: {
          enabled: true,
          sectionIds: [],
        },
      },
      assets: {
        promptReferencesKey: null,
        narrativeTemplateKey: 'inside-sales-report-narrative-template',
        glossaryKey: 'inside-sales-report-glossary',
      },
    },
    chat: {
      enabled: true,
      promptTemplates: [
        { label: 'Review call quality', prompt: 'Review the latest batch of call evaluations and flag quality issues' },
        { label: 'Score distribution', prompt: 'Show me the score distribution across recent evaluation runs' },
        { label: 'Generate insights', prompt: 'Generate actionable insights from the most recent evaluation results' },
      ],
      capabilities: ['analytics', 'report_builder'],
      dataSurfaces: [],
      entityResolvers: [],
    },
    pageIcons: {},
    pageTitles: {},
    pageActions: {
      evaluators: [
        { id: 'csv-import', kind: 'csvImport', requires: 'asset:create' },
      ],
    },
    quickActions: [
      {
        id: 'inside-sales-batch-eval',
        kind: 'openModal',
        label: 'Batch Evaluation',
        description: 'Evaluate a selected set of calls',
        icon: 'FileSpreadsheet',
        config: { modalId: 'insideSalesEval' },
      },
    ],
    evaluatorDetail: {
      interpretationBands: [
        { color: 'emerald', label: 'Strong', range: '80-100', description: 'Ready for independent calling' },
        { color: 'blue', label: 'Good', range: '65-79', description: 'Minor coaching points' },
        { color: 'amber', label: 'Needs Work', range: '50-64', description: 'Structured coaching required' },
        { color: 'red', label: 'Poor', range: 'Below 50', description: 'Re-training recommended' },
      ],
    },
    runDetail: {
      runShape: 'single',
      evalTypes: ['call_quality'],
      reportTab: { enabled: true },
      extras: {
        drilldown: { paramName: 'callId', route: 'calls/:callId', backLabel: 'Back to run' },
      },
      behaviour: { bannerOnlyOnFailed: true },
    },
  },
};

export function getAppMetadataFromConfig(appId: AppId, config?: AppConfig | null): AppMetadata {
  const fallback = APPS[appId];
  if (!config) return fallback;

  return {
    id: appId,
    name: config.displayName || fallback.name,
    icon: config.icon || fallback.icon,
    description: config.description || fallback.description,
    searchPlaceholder: fallback.searchPlaceholder,
    newItemLabel: fallback.newItemLabel,
  };
}

export function mergeAppConfig(appId: AppId, config?: Partial<AppConfig> | null): AppConfig {
  const fallback = APP_CONFIG_FALLBACKS[appId];
  if (!config) return fallback;

  return {
    ...fallback,
    ...config,
    features: {
      ...fallback.features,
      ...config.features,
    },
    reviews: {
      ...fallback.reviews,
      ...config.reviews,
      itemTypes: config.reviews?.itemTypes ?? fallback.reviews.itemTypes,
    },
    rules: {
      ...fallback.rules,
      ...config.rules,
    },
    evaluator: {
      ...fallback.evaluator,
      ...config.evaluator,
      variables: config.evaluator?.variables ?? fallback.evaluator.variables,
      dynamicVariableSources: {
        ...fallback.evaluator.dynamicVariableSources,
        ...config.evaluator?.dynamicVariableSources,
      },
    },
    assetDefaults: {
      ...fallback.assetDefaults,
      ...config.assetDefaults,
    },
    authorization: {
      ...fallback.authorization,
      ...config.authorization,
      assetPolicies: {
        ...fallback.authorization.assetPolicies,
        ...config.authorization?.assetPolicies,
        evaluator: {
          ...fallback.authorization.assetPolicies.evaluator,
          ...config.authorization?.assetPolicies?.evaluator,
          privateOnlyKeys: config.authorization?.assetPolicies?.evaluator?.privateOnlyKeys ?? fallback.authorization.assetPolicies.evaluator.privateOnlyKeys,
        },
        prompt: {
          ...fallback.authorization.assetPolicies.prompt,
          ...config.authorization?.assetPolicies?.prompt,
          privateOnlyKeys: config.authorization?.assetPolicies?.prompt?.privateOnlyKeys ?? fallback.authorization.assetPolicies.prompt.privateOnlyKeys,
        },
        schema: {
          ...fallback.authorization.assetPolicies.schema,
          ...config.authorization?.assetPolicies?.schema,
          privateOnlyKeys: config.authorization?.assetPolicies?.schema?.privateOnlyKeys ?? fallback.authorization.assetPolicies.schema.privateOnlyKeys,
        },
        settings: {
          ...fallback.authorization.assetPolicies.settings,
          ...config.authorization?.assetPolicies?.settings,
          privateOnlyKeys: config.authorization?.assetPolicies?.settings?.privateOnlyKeys ?? fallback.authorization.assetPolicies.settings.privateOnlyKeys,
        },
      },
    },
    evalRun: {
      ...fallback.evalRun,
      ...config.evalRun,
    },
    navigation: {
      ...fallback.navigation,
      ...config.navigation,
      ownedPathPrefixes: config.navigation?.ownedPathPrefixes ?? fallback.navigation.ownedPathPrefixes,
    },
    actions: {
      ...fallback.actions,
      ...config.actions,
      primaryNew: {
        ...fallback.actions.primaryNew,
        ...config.actions?.primaryNew,
        requirements: config.actions?.primaryNew?.requirements ?? fallback.actions.primaryNew.requirements,
      },
    },
    collections: {
      ...fallback.collections,
      ...config.collections,
      datasets: {
        ...fallback.collections.datasets,
        ...config.collections?.datasets,
      },
      drilldowns: {
        ...fallback.collections.drilldowns,
        ...config.collections?.drilldowns,
      },
    },
    analytics: {
      ...fallback.analytics,
      ...config.analytics,
      capabilities: {
        ...fallback.analytics.capabilities,
        ...config.analytics?.capabilities,
      },
      singleRun: {
        ...fallback.analytics.singleRun,
        ...config.analytics?.singleRun,
        sections: config.analytics?.singleRun?.sections ?? fallback.analytics.singleRun.sections,
        export: {
          ...fallback.analytics.singleRun.export,
          ...config.analytics?.singleRun?.export,
        },
        aiSummary: {
          ...fallback.analytics.singleRun.aiSummary,
          ...config.analytics?.singleRun?.aiSummary,
        },
      },
      crossRun: {
        ...fallback.analytics.crossRun,
        ...config.analytics?.crossRun,
        sections: config.analytics?.crossRun?.sections ?? fallback.analytics.crossRun.sections,
        export: {
          ...fallback.analytics.crossRun.export,
          ...config.analytics?.crossRun?.export,
        },
        aiSummary: {
          ...fallback.analytics.crossRun.aiSummary,
          ...config.analytics?.crossRun?.aiSummary,
        },
      },
      assets: {
        ...fallback.analytics.assets,
        ...config.analytics?.assets,
      },
    },
    chat: {
      ...fallback.chat,
      ...config.chat,
      promptTemplates: config.chat?.promptTemplates ?? fallback.chat.promptTemplates,
      capabilities: config.chat?.capabilities ?? fallback.chat.capabilities,
      dataSurfaces: config.chat?.dataSurfaces ?? fallback.chat.dataSurfaces,
      entityResolvers: config.chat?.entityResolvers ?? fallback.chat.entityResolvers,
    },
    pageIcons: {
      ...(fallback.pageIcons ?? {}),
      ...(config.pageIcons ?? {}),
    },
    pageTitles: {
      ...(fallback.pageTitles ?? {}),
      ...(config.pageTitles ?? {}),
    },
    pageActions: {
      ...(fallback.pageActions ?? {}),
      ...(config.pageActions ?? {}),
    },
    quickActions: config.quickActions ?? fallback.quickActions ?? [],
    evaluatorDetail: {
      interpretationBands:
        config.evaluatorDetail?.interpretationBands
        ?? fallback.evaluatorDetail?.interpretationBands
        ?? [],
    },
    runDetail: mergeRunDetailConfig(config.runDetail, fallback.runDetail),
  };
}

function mergeRunDetailConfig(
  override: AppRunDetailConfig | undefined,
  base: AppRunDetailConfig | undefined,
): AppRunDetailConfig | undefined {
  if (!override && !base) return undefined;
  const fb: AppRunDetailConfig = base ?? {
    runShape: 'single',
    evalTypes: [],
    reportTab: { enabled: false },
    extras: {},
    behaviour: {},
  };
  if (!override) return fb;
  return {
    runShape: override.runShape ?? fb.runShape,
    evalTypes: override.evalTypes ?? fb.evalTypes,
    reportTab: { ...fb.reportTab, ...override.reportTab },
    extras: { ...fb.extras, ...override.extras },
    behaviour: { ...fb.behaviour, ...override.behaviour },
  };
}
