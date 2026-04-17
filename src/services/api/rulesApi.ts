/**
 * Rules API - HTTP client for published app rule catalogs.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 */
import { apiRequest } from './client';
import type { AppId, AppRulesConfig, RuleCatalogEntry, RuleCatalogResponse } from '@/types';

interface ApiRuleCatalogEntry {
  ruleId: string;
  ruleText: string;
  section?: string;
  tags?: string[];
  goalIds?: string[];
  evaluationScopes?: string[];
  [key: string]: unknown;
}

interface ApiRuleCatalogResponse {
  rules: ApiRuleCatalogEntry[];
}

function toRuleCatalogEntry(rule: ApiRuleCatalogEntry): RuleCatalogEntry {
  return {
    ...rule,
    ruleId: String(rule.ruleId),
    ruleText: String(rule.ruleText),
    section: rule.section ?? '',
    tags: Array.isArray(rule.tags) ? [...rule.tags] : [],
    goalIds: Array.isArray(rule.goalIds) ? [...rule.goalIds] : [],
    evaluationScopes: Array.isArray(rule.evaluationScopes) ? [...rule.evaluationScopes] : [],
  };
}

function toRuleCatalogResponse(raw: ApiRuleCatalogResponse): RuleCatalogResponse {
  return {
    rules: Array.isArray(raw.rules) ? raw.rules.map(toRuleCatalogEntry) : [],
  };
}

export const rulesRepository = {
  async get(appId: AppId, rulesConfig: AppRulesConfig): Promise<RuleCatalogResponse> {
    const params = new URLSearchParams({ app_id: appId });
    if (rulesConfig.catalogSource === 'settings' && rulesConfig.catalogKey) {
      params.set('catalog_key', rulesConfig.catalogKey);
    }
    const data = await apiRequest<ApiRuleCatalogResponse>(`/api/rules?${params}`);
    return toRuleCatalogResponse(data);
  },

  async save(appId: AppId, catalog: RuleCatalogResponse): Promise<RuleCatalogResponse> {
    const params = new URLSearchParams({ app_id: appId });
    const data = await apiRequest<ApiRuleCatalogResponse>(`/api/rules?${params}`, {
      method: 'PUT',
      body: JSON.stringify(catalog),
    });
    return toRuleCatalogResponse(data);
  },
};
