import type { AssetVisibility } from './settings.types';

export interface ReportConfigSummary {
  id: string;
  appId: string;
  reportId: string;
  scope: string;
  name: string;
  description: string;
  status: string;
  isDefault: boolean;
  visibility: AssetVisibility;
  sharedBy?: string | null;
  sharedAt?: string | null;
  presentationConfig: Record<string, unknown>;
  narrativeConfig: Record<string, unknown>;
  exportConfig: Record<string, unknown>;
  defaultReportRunVisibility: AssetVisibility;
  version: number;
  tenantId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRunSummary {
  id: string;
  appId: string;
  reportId: string;
  scope: string;
  sourceEvalRunId?: string | null;
  status: string;
  jobId?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  reportConfigVersion?: number | null;
  promptAssetVersion?: string | null;
  schemaAssetVersion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  tenantId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}
