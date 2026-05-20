import { apiRequest } from '@/services/api/client';

export type CallSiteScope = 'tenant' | 'platform';

export interface CallSiteSpec {
  id: string;
  requiredCapabilities: string[];
  optionalCapabilities: string[];
  description: string;
  reference: string;
}

export interface CallSiteDefault {
  callSite: string;
  scope: CallSiteScope;
  provider: string;
  credentialName: string;
  modelOrDeployment: string;
  updatedAt: string | null;
}

export interface CallSiteDefaultUpsert {
  provider: string;
  credentialName: string;
  modelOrDeployment: string;
}

export const callSiteDefaultsApi = {
  listTenant: (): Promise<CallSiteDefault[]> =>
    apiRequest<CallSiteDefault[]>('/api/admin/llm/defaults'),

  upsertTenant: (
    callSite: string,
    body: CallSiteDefaultUpsert,
  ): Promise<CallSiteDefault> =>
    apiRequest<CallSiteDefault>(`/api/admin/llm/defaults/${callSite}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteTenant: (callSite: string): Promise<void> =>
    apiRequest<void>(`/api/admin/llm/defaults/${callSite}`, {
      method: 'DELETE',
    }),

  listPlatform: (): Promise<CallSiteDefault[]> =>
    apiRequest<CallSiteDefault[]>('/api/platform/llm/defaults'),

  upsertPlatform: (
    callSite: string,
    body: CallSiteDefaultUpsert,
  ): Promise<CallSiteDefault> =>
    apiRequest<CallSiteDefault>(`/api/platform/llm/defaults/${callSite}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  listCallSites: (): Promise<CallSiteSpec[]> =>
    apiRequest<CallSiteSpec[]>('/api/llm/call-sites'),
};
