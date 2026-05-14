import { useQuery } from '@tanstack/react-query';

import { apiQueryFn } from '@/features/orchestration/queries/queryFn';

/**
 * Phase 11D — schema-driven CRM workspace. `useCrmSchema` fetches one
 * manifest catalog table from `GET /api/analytics/crm-schema/{app}/{table}`
 * so filter panels, column headers, and the AttributesPanel read column
 * metadata from the manifest instead of a hardcoded TypeScript file.
 *
 * Query key `['analytics', 'crm-schema', appId, tableName]`; 5-minute
 * stale time (the manifest only changes on boot or a signal-definition
 * admin edit).
 */
export interface CrmSchemaColumn {
  role: string;
  dataType: string | null;
  semanticType: string | null;
  description: string | null;
  synonyms: string[];
  allowedValues: (string | number | boolean)[];
  measureKind: string | null;
  unit: string | null;
  nullable: boolean | null;
  pii: boolean;
}

export interface CrmSchemaAttributeKey {
  dataType: string;
  semanticType: string | null;
  description: string | null;
  unit: string | null;
  allowedValues: (string | number | boolean)[];
  synonyms: string[];
  nullable: boolean;
  pii: boolean;
}

export interface CrmSchema {
  appId: string;
  tableName: string;
  columns: Record<string, CrmSchemaColumn>;
  /** Outer key is the discriminator value (activity_type / signal_type /
   *  to_stage; `_default` for tables with no discriminator). */
  attributeSchemas: Record<string, Record<string, CrmSchemaAttributeKey>>;
}

export function useCrmSchema(appId: string, tableName: string) {
  return useQuery<CrmSchema>({
    queryKey: ['analytics', 'crm-schema', appId, tableName],
    queryFn: () =>
      apiQueryFn<CrmSchema>(
        `/api/analytics/crm-schema/${encodeURIComponent(appId)}/${encodeURIComponent(tableName)}`,
      ),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(appId && tableName),
  });
}
