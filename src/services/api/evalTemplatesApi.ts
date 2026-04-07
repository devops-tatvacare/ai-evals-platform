/**
 * Eval Templates API - HTTP client for eval-templates API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 */
import type { EvalTemplate, CreateTemplatePayload, NewVersionPayload, TemplateType } from '@/types';
import { normalizeAssetVisibility } from '@/types/settings.types';
import type { AssetVisibility, LegacyAssetVisibility } from '@/types/settings.types';
import { apiRequest } from './client';

/** Shape returned by backend (camelCase, dates as strings) */
interface ApiEvalTemplate {
  id: string;
  userId?: string;
  tenantId?: string;
  ownerName?: string;
  appId: string;
  templateType: string;
  sourceType?: string | null;
  branchKey: string;
  version: number;
  name: string;
  description?: string;
  prompt: string;
  schemaData: Record<string, unknown> | unknown[];
  schemaFormat: string;
  variablesUsed: string[];
  changeSummary?: string | null;
  isDefault?: boolean;
  forkedFrom?: string | null;
  visibility: LegacyAssetVisibility;
  sharedBy?: string | null;
  sharedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalTemplateListOptions {
  templateType?: TemplateType;
  sourceType?: string;
  latestOnly?: boolean;
  filter?: AssetVisibility;
}

export function toEvalTemplate(raw: ApiEvalTemplate): EvalTemplate {
  return {
    id: raw.id,
    userId: raw.userId,
    tenantId: raw.tenantId,
    ownerName: raw.ownerName,
    appId: raw.appId,
    templateType: raw.templateType as EvalTemplate['templateType'],
    sourceType: (raw.sourceType as EvalTemplate['sourceType']) ?? null,
    branchKey: raw.branchKey,
    version: raw.version,
    name: raw.name,
    description: raw.description,
    prompt: raw.prompt,
    schemaData: raw.schemaData as EvalTemplate['schemaData'],
    schemaFormat: raw.schemaFormat as EvalTemplate['schemaFormat'],
    variablesUsed: raw.variablesUsed ?? [],
    changeSummary: (raw.changeSummary as EvalTemplate['changeSummary']) ?? null,
    isDefault: raw.isDefault,
    forkedFrom: raw.forkedFrom ?? null,
    visibility: normalizeAssetVisibility(raw.visibility),
    sharedBy: raw.sharedBy ?? null,
    sharedAt: raw.sharedAt ?? null,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
}

export const evalTemplatesRepository = {
  async getAll(appId: string, opts: EvalTemplateListOptions = {}): Promise<EvalTemplate[]> {
    const params = new URLSearchParams({ app_id: appId });
    if (opts.templateType) {
      params.append('template_type', opts.templateType);
    }
    if (opts.sourceType) {
      params.append('source_type', opts.sourceType);
    }
    if (opts.latestOnly !== undefined) {
      params.append('latest_only', String(opts.latestOnly));
    }
    if (opts.filter) {
      params.append('filter', opts.filter);
    }
    const data = await apiRequest<ApiEvalTemplate[]>(`/api/eval-templates?${params}`);
    return data.map(toEvalTemplate);
  },

  async getById(id: string): Promise<EvalTemplate | null> {
    try {
      const data = await apiRequest<ApiEvalTemplate>(`/api/eval-templates/${id}`);
      return toEvalTemplate(data);
    } catch {
      return null;
    }
  },

  async getBranchVersions(appId: string, branchKey: string): Promise<EvalTemplate[]> {
    const params = new URLSearchParams({ app_id: appId });
    const data = await apiRequest<ApiEvalTemplate[]>(
      `/api/eval-templates/branch/${encodeURIComponent(branchKey)}/versions?${params}`,
    );
    return data.map(toEvalTemplate);
  },

  async create(appId: string, payload: CreateTemplatePayload): Promise<EvalTemplate> {
    const data = await apiRequest<ApiEvalTemplate>('/api/eval-templates', {
      method: 'POST',
      body: JSON.stringify({ ...payload, appId }),
    });
    return toEvalTemplate(data);
  },

  async createNewVersion(templateId: string, payload: NewVersionPayload): Promise<EvalTemplate> {
    const data = await apiRequest<ApiEvalTemplate>(`/api/eval-templates/${templateId}/new-version`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return toEvalTemplate(data);
  },

  async fork(appId: string, templateId: string): Promise<EvalTemplate> {
    const params = new URLSearchParams({ app_id: appId });
    const data = await apiRequest<ApiEvalTemplate>(
      `/api/eval-templates/${templateId}/fork?${params}`,
      { method: 'POST' },
    );
    return toEvalTemplate(data);
  },

  async updateMetadata(
    templateId: string,
    updates: Partial<Pick<EvalTemplate, 'name' | 'description'>>,
  ): Promise<EvalTemplate> {
    const data = await apiRequest<ApiEvalTemplate>(`/api/eval-templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return toEvalTemplate(data);
  },

  async setVisibility(templateId: string, visibility: AssetVisibility): Promise<EvalTemplate> {
    const data = await apiRequest<ApiEvalTemplate>(`/api/eval-templates/${templateId}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    });
    return toEvalTemplate(data);
  },

  async delete(templateId: string): Promise<void> {
    await apiRequest(`/api/eval-templates/${templateId}`, {
      method: 'DELETE',
    });
  },
};
