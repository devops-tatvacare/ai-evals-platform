/**
 * Apps API - HTTP client for registered app metadata and config.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Config payloads are merged against local fallbacks so the frontend can
 * keep rendering while app configs are loading or partially seeded.
 */
import { apiRequest } from './client';
import {
  APP_CONFIG_FALLBACKS,
  mergeAppConfig,
  normalizeAssetVisibility,
  type AppAssetPolicyConfig,
  type AppConfig,
  type AppId,
  type AppSummary,
  type EvaluatorDetailBand,
  type EvaluatorDetailBandColor,
  type EvaluatorDetailConfig,
  type PageActionSpec,
  type QuickActionSpec,
} from '@/types';

interface ApiAppSummary {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  iconUrl: string;
  isActive: boolean;
}

type ApiAppConfig = Partial<AppConfig>;

function normalizeOptionalVisibility(
  visibility: 'private' | 'shared' | 'app' | undefined,
  fallback: 'private' | 'shared',
): 'private' | 'shared' {
  return visibility === undefined ? fallback : normalizeAssetVisibility(visibility);
}

function normalizeAssetPolicyConfig(
  policy: Record<string, unknown> | undefined,
  fallback: AppAssetPolicyConfig,
): AppAssetPolicyConfig {
  return {
    ...fallback,
    ...(policy as Partial<AppAssetPolicyConfig> | undefined),
    privateOnlyKeys: Array.isArray(policy?.privateOnlyKeys)
      ? policy.privateOnlyKeys.filter((value): value is string => typeof value === 'string')
      : fallback.privateOnlyKeys,
  };
}

function mergeNamedConfigMap<T extends object>(
  fallback: Record<string, T>,
  override: unknown,
): Record<string, T> {
  if (typeof override !== 'object' || override === null) {
    return fallback;
  }

  const overrideRecord = override as Record<string, unknown>;
  const mergedEntries = Array.from(new Set([...Object.keys(fallback), ...Object.keys(overrideRecord)])).map((key) => {
    const fallbackValue = fallback[key] ?? ({} as T);
    const overrideValue = overrideRecord[key];
    if (typeof overrideValue !== 'object' || overrideValue === null) {
      return [key, fallbackValue] as const;
    }
    return [key, { ...fallbackValue, ...(overrideValue as Partial<T>) }] as const;
  });

  return Object.fromEntries(mergedEntries) as Record<string, T>;
}

function normalizeAppConfig(appId: AppId, config: Record<string, unknown>): Partial<AppConfig> {
  const rawAssetDefaults =
    typeof config.assetDefaults === 'object' && config.assetDefaults !== null
      ? (config.assetDefaults as Record<string, unknown>)
      : {};
  const rawAuthorization =
    typeof config.authorization === 'object' && config.authorization !== null
      ? (config.authorization as Record<string, unknown>)
      : {};
  const rawAssetPolicies =
    typeof rawAuthorization.assetPolicies === 'object' && rawAuthorization.assetPolicies !== null
      ? (rawAuthorization.assetPolicies as Record<string, unknown>)
      : {};
  const rawAnalytics =
    typeof config.analytics === 'object' && config.analytics !== null
      ? (config.analytics as Record<string, unknown>)
      : {};
  const rawAnalyticsAssets =
    typeof rawAnalytics.assets === 'object' && rawAnalytics.assets !== null
      ? (rawAnalytics.assets as Record<string, unknown>)
      : {};
  const rawEvaluator =
    typeof config.evaluator === 'object' && config.evaluator !== null
      ? (config.evaluator as Record<string, unknown>)
      : {};
  const rawCollections =
    typeof config.collections === 'object' && config.collections !== null
      ? (config.collections as Record<string, unknown>)
      : {};
  const rawReviews =
    typeof config.reviews === 'object' && config.reviews !== null
      ? (config.reviews as Record<string, unknown>)
      : {};
  const rawChat =
    typeof config.chat === 'object' && config.chat !== null
      ? (config.chat as Record<string, unknown>)
      : {};

  return {
    ...config,
    evaluator: {
      ...APP_CONFIG_FALLBACKS[appId].evaluator,
      ...(rawEvaluator as Partial<AppConfig['evaluator']>),
      defaultVisibility: normalizeOptionalVisibility(
        rawEvaluator.defaultVisibility as 'private' | 'shared' | 'app' | undefined,
        APP_CONFIG_FALLBACKS[appId].evaluator.defaultVisibility,
      ),
    },
    assetDefaults: {
      ...APP_CONFIG_FALLBACKS[appId].assetDefaults,
      evaluator: normalizeOptionalVisibility(
        rawAssetDefaults.evaluator as 'private' | 'shared' | 'app' | undefined,
        APP_CONFIG_FALLBACKS[appId].assetDefaults.evaluator,
      ),
      prompt: normalizeOptionalVisibility(
        rawAssetDefaults.prompt as 'private' | 'shared' | 'app' | undefined,
        APP_CONFIG_FALLBACKS[appId].assetDefaults.prompt,
      ),
      schema: normalizeOptionalVisibility(
        rawAssetDefaults.schema as 'private' | 'shared' | 'app' | undefined,
        APP_CONFIG_FALLBACKS[appId].assetDefaults.schema,
      ),
      adversarialContract: normalizeOptionalVisibility(
        (rawAssetDefaults.adversarialContract ?? rawAssetDefaults.adversarial_contract) as 'private' | 'shared' | 'app' | undefined,
        APP_CONFIG_FALLBACKS[appId].assetDefaults.adversarialContract,
      ),
    },
    authorization: {
      ...APP_CONFIG_FALLBACKS[appId].authorization,
      ...(rawAuthorization as Partial<AppConfig['authorization']>),
      assetPolicies: {
        ...APP_CONFIG_FALLBACKS[appId].authorization.assetPolicies,
        evaluator: normalizeAssetPolicyConfig(
          rawAssetPolicies.evaluator as Record<string, unknown> | undefined,
          APP_CONFIG_FALLBACKS[appId].authorization.assetPolicies.evaluator,
        ),
        prompt: normalizeAssetPolicyConfig(
          rawAssetPolicies.prompt as Record<string, unknown> | undefined,
          APP_CONFIG_FALLBACKS[appId].authorization.assetPolicies.prompt,
        ),
        schema: normalizeAssetPolicyConfig(
          (rawAssetPolicies.schema ?? rawAssetPolicies.schema_) as Record<string, unknown> | undefined,
          APP_CONFIG_FALLBACKS[appId].authorization.assetPolicies.schema,
        ),
        settings: normalizeAssetPolicyConfig(
          rawAssetPolicies.settings as Record<string, unknown> | undefined,
          APP_CONFIG_FALLBACKS[appId].authorization.assetPolicies.settings,
        ),
      },
    },
    collections: {
      ...APP_CONFIG_FALLBACKS[appId].collections,
      ...(rawCollections as Partial<AppConfig['collections']>),
      datasets: mergeNamedConfigMap(
        APP_CONFIG_FALLBACKS[appId].collections.datasets,
        rawCollections.datasets,
      ),
      drilldowns: mergeNamedConfigMap(
        APP_CONFIG_FALLBACKS[appId].collections.drilldowns,
        rawCollections.drilldowns,
      ),
    },
    reviews: {
      ...APP_CONFIG_FALLBACKS[appId].reviews,
      ...(rawReviews as Partial<AppConfig['reviews']>),
      itemTypes:
        (rawReviews.itemTypes as string[] | undefined)
        ?? (rawReviews.item_types as string[] | undefined)
        ?? APP_CONFIG_FALLBACKS[appId].reviews.itemTypes,
      defaultEntryPoint:
        (rawReviews.defaultEntryPoint as string | undefined)
        ?? (rawReviews.default_entry_point as string | undefined)
        ?? APP_CONFIG_FALLBACKS[appId].reviews.defaultEntryPoint,
    },
    analytics: {
      ...APP_CONFIG_FALLBACKS[appId].analytics,
      ...(rawAnalytics as Partial<AppConfig['analytics']>),
      assets: {
        ...APP_CONFIG_FALLBACKS[appId].analytics.assets,
        promptReferencesKey: (
          rawAnalyticsAssets.promptReferencesKey ?? rawAnalyticsAssets.prompt_references_key
        ) as string | null | undefined
          ?? APP_CONFIG_FALLBACKS[appId].analytics.assets.promptReferencesKey,
        narrativeTemplateKey: (
          rawAnalyticsAssets.narrativeTemplateKey ?? rawAnalyticsAssets.narrative_template_key
        ) as string | null | undefined
          ?? APP_CONFIG_FALLBACKS[appId].analytics.assets.narrativeTemplateKey,
        glossaryKey: (
          rawAnalyticsAssets.glossaryKey ?? rawAnalyticsAssets.glossary_key
        ) as string | null | undefined
          ?? APP_CONFIG_FALLBACKS[appId].analytics.assets.glossaryKey,
      },
    },
    chat: {
      ...APP_CONFIG_FALLBACKS[appId].chat,
      ...(rawChat as Partial<AppConfig['chat']>),
      promptTemplates:
        (rawChat.promptTemplates as AppConfig['chat']['promptTemplates'] | undefined)
        ?? (rawChat.prompt_templates as AppConfig['chat']['promptTemplates'] | undefined)
        ?? APP_CONFIG_FALLBACKS[appId].chat.promptTemplates,
      capabilities:
        (rawChat.capabilities as string[] | undefined)
        ?? APP_CONFIG_FALLBACKS[appId].chat.capabilities,
      dataSurfaces:
        (rawChat.dataSurfaces as AppConfig['chat']['dataSurfaces'] | undefined)
        ?? (rawChat.data_surfaces as AppConfig['chat']['dataSurfaces'] | undefined)
        ?? APP_CONFIG_FALLBACKS[appId].chat.dataSurfaces,
      entityResolvers:
        (rawChat.entityResolvers as AppConfig['chat']['entityResolvers'] | undefined)
        ?? (rawChat.entity_resolvers as AppConfig['chat']['entityResolvers'] | undefined)
        ?? APP_CONFIG_FALLBACKS[appId].chat.entityResolvers,
    },
    pageIcons: normalizeStringMap(config.pageIcons ?? config.page_icons),
    pageTitles: normalizeStringMap(config.pageTitles ?? config.page_titles),
    pageActions: normalizePageActions(config.pageActions ?? config.page_actions),
    quickActions: normalizeQuickActions(config.quickActions ?? config.quick_actions),
    evaluatorDetail: normalizeEvaluatorDetail(config.evaluatorDetail ?? config.evaluator_detail),
  };
}

const EVALUATOR_DETAIL_BAND_COLORS: readonly EvaluatorDetailBandColor[] = [
  'emerald',
  'blue',
  'amber',
  'red',
];

function normalizeEvaluatorDetail(value: unknown): EvaluatorDetailConfig | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const rawBands = raw.interpretationBands ?? raw.interpretation_bands;
  if (!Array.isArray(rawBands)) return { interpretationBands: [] };
  const bands: EvaluatorDetailBand[] = [];
  for (const entry of rawBands) {
    if (typeof entry !== 'object' || entry === null) continue;
    const band = entry as Record<string, unknown>;
    if (
      typeof band.color !== 'string'
      || !EVALUATOR_DETAIL_BAND_COLORS.includes(band.color as EvaluatorDetailBandColor)
      || typeof band.label !== 'string'
      || typeof band.range !== 'string'
      || typeof band.description !== 'string'
    ) {
      continue;
    }
    bands.push({
      color: band.color as EvaluatorDetailBandColor,
      label: band.label,
      range: band.range,
      description: band.description,
    });
  }
  return { interpretationBands: bands };
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}

function normalizePageActions(value: unknown): AppConfig['pageActions'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const out: Record<string, PageActionSpec[]> = {};
  for (const [pageType, specs] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(specs)) continue;
    const normalized = specs
      .map((spec) => normalizePageActionSpec(spec))
      .filter((spec): spec is PageActionSpec => spec !== null);
    if (normalized.length > 0) {
      out[pageType] = normalized;
    }
  }
  return out as AppConfig['pageActions'];
}

const QUICK_ACTION_KINDS = ['openModal', 'triggerImperative', 'navigateTo'] as const;
type QuickActionKind = (typeof QUICK_ACTION_KINDS)[number];

function normalizeQuickActions(value: unknown): QuickActionSpec[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: QuickActionSpec[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.label !== 'string') continue;
    const kind = raw.kind;
    if (typeof kind !== 'string' || !QUICK_ACTION_KINDS.includes(kind as QuickActionKind)) continue;
    const config =
      typeof raw.config === 'object' && raw.config !== null
        ? (raw.config as Record<string, unknown>)
        : undefined;
    const requirements = Array.isArray(raw.requirements)
      ? (raw.requirements as QuickActionSpec['requirements'])
      : undefined;
    out.push({
      id: raw.id,
      kind: kind as QuickActionKind,
      label: raw.label,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.icon === 'string' ? { icon: raw.icon } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(typeof raw.requires === 'string' ? { requires: raw.requires } : {}),
      ...(requirements !== undefined ? { requirements } : {}),
    });
  }
  return out;
}

function normalizePageActionSpec(value: unknown): PageActionSpec | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.kind !== 'string') return null;
  const config =
    typeof raw.config === 'object' && raw.config !== null
      ? (raw.config as Record<string, unknown>)
      : undefined;
  const requires = typeof raw.requires === 'string' ? raw.requires : undefined;
  return {
    id: raw.id,
    kind: raw.kind,
    ...(config !== undefined ? { config } : {}),
    ...(requires !== undefined ? { requires } : {}),
  };
}

function toAppSummary(app: ApiAppSummary): AppSummary {
  return {
    id: app.id,
    slug: app.slug,
    displayName: app.displayName,
    description: app.description,
    iconUrl: app.iconUrl,
    isActive: app.isActive,
  };
}

export function toAppConfig(appId: AppId, config: ApiAppConfig): AppConfig {
  return mergeAppConfig(appId, normalizeAppConfig(appId, config as Record<string, unknown>));
}

export const appsRepository = {
  async getAll(): Promise<AppSummary[]> {
    const data = await apiRequest<ApiAppSummary[]>('/api/apps');
    return data.map(toAppSummary);
  },

  async getConfig(appId: AppId): Promise<AppConfig> {
    const data = await apiRequest<ApiAppConfig>(`/api/apps/${appId}/config`);
    return toAppConfig(appId, data);
  },
};
