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
  llmSettings: 'private' | 'shared';
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
}

export type AppActionRequirementSource = 'appSettings' | 'globalSettings' | 'llmSettings';
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
}

export interface AppConfig {
  displayName: string;
  icon: string;
  description: string;
  features: AppFeaturesConfig;
  rules: AppRulesConfig;
  evaluator: AppEvaluatorConfig;
  assetDefaults: AppAssetDefaults;
  authorization: AppAuthorizationConfig;
  evalRun: AppEvalRunConfig;
  navigation: AppNavigationConfig;
  actions: AppActionsConfig;
  analytics: AppAnalyticsConfig;
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
    settings: {
      ...DEFAULT_ASSET_POLICY_CONFIG,
      privateOnlyKeys: ['llm-settings'],
    },
  },
};

const DEFAULT_APP_ACTIONS_CONFIG: AppActionsConfig = {
  primaryNew: {
    requirements: [],
  },
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
      llmSettings: 'private',
    },
    authorization: DEFAULT_APP_AUTHORIZATION_CONFIG,
    evalRun: {
      supportedTypes: [],
    },
    navigation: {
      homePath: '/',
      ownedPathPrefixes: ['/dashboard', '/upload', '/listing', '/runs', '/logs', '/settings', '/evaluators'],
      settingsPath: '/settings',
      logsPath: '/logs',
      runsPath: '/runs',
      runDetailPath: '/runs/:runId',
      threadDetailPath: null,
    },
    actions: DEFAULT_APP_ACTIONS_CONFIG,
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
    },
    rules: {
      catalogSource: 'settings',
      catalogKey: 'rule-catalog',
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
      llmSettings: 'private',
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
      llmSettings: 'private',
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
    },
    actions: DEFAULT_APP_ACTIONS_CONFIG,
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
  };
}
