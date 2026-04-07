import type { AssetVisibility } from './settings.types';
import type { EvaluatorOutputField } from './evaluator.types';

export type EvalTemplateOutputField = EvaluatorOutputField;

export type TemplateType = 'transcription' | 'evaluation' | 'extraction';

export interface EvalTemplate {
  id: string;
  userId?: string;
  tenantId?: string;
  ownerName?: string;
  appId: string;
  templateType: TemplateType;
  sourceType?: 'upload' | 'api' | null;
  branchKey: string;
  version: number;
  name: string;
  description?: string;
  prompt: string;
  schemaData: Record<string, unknown> | EvalTemplateOutputField[];
  schemaFormat: 'json_schema' | 'output_fields';
  variablesUsed: string[];
  changeSummary?: 'prompt' | 'schema' | 'both' | 'created' | null;
  isDefault?: boolean;
  forkedFrom?: string | null;
  visibility?: AssetVisibility;
  sharedBy?: string | null;
  sharedAt?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplatePayload {
  appId: string;
  templateType: string;
  sourceType?: string | null;
  name: string;
  prompt: string;
  schemaData: Record<string, unknown> | unknown[];
  schemaFormat: string;
  description?: string;
  visibility?: string;
}

export interface NewVersionPayload {
  prompt: string;
  schemaData: Record<string, unknown> | unknown[];
  schemaFormat?: string;
  name?: string;
  description?: string;
}
