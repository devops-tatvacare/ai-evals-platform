import { apiRequest } from './client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LeadPlanPurchase {
  planName: string | null;
  durationOrQuantity: string | null;
  programPrice: string | null;
  invoiceAmount: string | null;
  paymentId: string | null;
  paymentDateAndTime: string | null;
  planAssignedAt: string | null;
  signUpDate: string | null;
  programStartDate: string | null;
  programEndDate: string | null;
  planIncludesCgm: string | null;
  cgm: string | null;
  cgmBrand: string | null;
  sensorCount: string | null;
  transmitterCount: string | null;
  bcaDevice: string | null;
  nutraceuticalsSold: string | null;
  salesTeam: string | null;
  deviceAwbNumber: string | null;
  leadConversionDate: string | null;
}

/**
 * One `dim_lead` row in the manifest `{structural columns + attributes
 * JSONB}` shape (Phase 11E). Identity + current-state are typed structural
 * columns; `attributesAtFirstSeen` is the frozen lead-profile snapshot
 * (age_group, condition, hba1c_band, intent_to_pay, source_campaign, ...)
 * and `attributes` is the mutable current-state bag (plan_name, ...). Both
 * bags are rendered generically against `useCrmSchema` — no field is
 * flattened into a bespoke named property. PII columns
 * (`firstName/lastName/phone/email/city`) arrive pre-masked from the
 * role-aware serializer.
 */
export interface LeadListRecord {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  prospectStage: string | null;
  repName: string | null;
  source: string | null;
  createdOn: string;
  mqlScore: number | null;
  mqlSignals: Record<string, boolean>;
  attributesAtFirstSeen: Record<string, unknown>;
  attributes: Record<string, unknown>;
}

export interface LeadListResponse {
  leads: LeadListRecord[];
  total: number;
  page: number;
  pageSize: number;
  freshness: CollectionFreshness;
}

/**
 * One `fact_lead_activity` (call) row in the manifest `{structural columns
 * + attributes JSONB}` shape (Phase 11E). Typed structural columns at the
 * top level; the call-specific payload (direction, status,
 * duration_seconds, recording_url, phone_number, display_number,
 * call_notes, call_session_id, rep_email, has_recording, event_code) lives
 * in `attributes` and is rendered generically against `useCrmSchema`. PII
 * keys inside `attributes` arrive pre-masked from the role-aware
 * serializer.
 */
export interface CallRecord {
  activityId: string;
  leadId: string;
  repName: string | null;
  eventCode: number | null;
  activityType: string;
  callStartTime: string;
  createdOn: string;
  attributes: Record<string, unknown>;
  lastEvalScore?: number;
  evalCount?: number;
}

export interface CallListResponse {
  calls: CallRecord[];
  total: number;
  page: number;
  pageSize: number;
  freshness: CollectionFreshness;
}

export interface CollectionFreshness {
  lastSyncedAt: string | null;
  syncInProgress: boolean;
  stale: boolean;
}

export interface CallFilters {
  agents: string[];
  /** Multi-select via the suggestions endpoint; CSV-joined on the wire. */
  leadId: string[];
  direction: string;
  status: string;
  hasRecording: boolean;
  eventCodes: string;
  durationMin: string;
  durationMax: string;
}

export interface LeadCallRecord {
  activityId: string;
  callTime: string;
  repName: string | null;
  durationSeconds: number;
  status: string;
  recordingUrl: string | null;
  evalScore: number | null;
  isCounseling: boolean;
}

export interface LeadEvalHistoryEntry {
  id: string;
  threadId: string;
  runId: string;
  result: Record<string, unknown>;
  createdAt: string;
}

export interface LeadDetailFullResponse {
  leadId: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  prospectStage: string;
  city: string | null;
  ageGroup: string | null;
  condition: string | null;
  hba1cBand: string | null;
  bloodSugarBand: string | null;
  diabetesDuration: string | null;
  currentManagement: string | null;
  goal: string | null;
  intentToPay: string | null;
  jobTitle: string | null;
  preferredCallTime: string | null;
  repName: string | null;
  source: string | null;
  sourceCampaign: string | null;
  createdOn: string;
  mqlScore: number;
  mqlSignals: Record<string, boolean>;
  frtSeconds: number | null;
  totalDials: number;
  connectRate: number | null;
  counselingCount: number;
  counselingRate: number | null;
  callbackAdherenceSeconds: number | null;
  leadAgeDays: number;
  daysSinceLastContact: number | null;
  callHistory: LeadCallRecord[];
  historyTruncated: boolean;
  evalHistory: LeadEvalHistoryEntry[];
  plan: LeadPlanPurchase;
}

// ── API functions ──────────────────────────────────────────────────────────

export interface LeadFilters {
  /** Multi-select via the suggestions endpoint; CSV-joined on the wire. */
  agents: string[];
  stage: string[];
  mqlMin: string;
  condition: string[];
  /** Multi-select via the suggestions endpoint; CSV-joined on the wire. */
  city: string[];
  /** Multi-select via the suggestions endpoint; CSV-joined on the wire. */
  leadId: string[];
  /** Multi-select via the suggestions endpoint; CSV-joined on the wire. */
  phone: string[];
  /** Multi-select via the suggestions endpoint; CSV-joined on the wire. */
  planName: string[];
  q: string;
}

export type CallQueryScope = 'page' | 'all';
export type InsideSalesCollectionFamily = 'calls' | 'leads';

export interface CollectionSyncStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: 'running' | 'completed' | 'failed' | 'cancelled' | null;
  lastError: string | null;
  syncInProgress: boolean;
}

export async function fetchCollectionStatus(
  sourceFamily: InsideSalesCollectionFamily,
): Promise<CollectionSyncStatus> {
  return apiRequest<CollectionSyncStatus>(
    `/api/inside-sales/collections/${encodeURIComponent(sourceFamily)}/status`,
  );
}

export type SuggestionField =
  | 'lead_id'
  | 'phone'
  | 'rep_name'
  | 'city'
  | 'stage'
  | 'plan_name';

export async function fetchCollectionSuggestions(
  sourceFamily: InsideSalesCollectionFamily,
  field: SuggestionField,
  q: string,
  limit = 20,
): Promise<string[]> {
  const params = new URLSearchParams({ field, limit: String(limit) });
  const trimmed = (q ?? '').trim();
  if (trimmed) params.set('q', trimmed);
  const res = await apiRequest<{ values: string[] }>(
    `/api/inside-sales/collections/${encodeURIComponent(sourceFamily)}/suggestions?${params.toString()}`,
  );
  return res.values ?? [];
}

function buildCallSearchParams(
  filters: CallFilters,
  page: number,
  pageSize: number,
  scope: CallQueryScope,
): URLSearchParams {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });

  if (scope !== 'page') {
    params.set('scope', scope);
  }
  if (filters.agents && filters.agents.length > 0) params.set('agents', filters.agents.join(','));
  if (filters.leadId && filters.leadId.length > 0) params.set('lead_id', filters.leadId.join(','));
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.status) params.set('status', filters.status);
  if (filters.hasRecording) params.set('has_recording', 'true');
  if (filters.durationMin) params.set('duration_min', filters.durationMin);
  if (filters.durationMax) params.set('duration_max', filters.durationMax);
  if (filters.eventCodes) params.set('event_codes', filters.eventCodes);

  return params;
}

export async function fetchCalls(
  filters: CallFilters,
  page: number,
  pageSize: number,
  options?: { scope?: CallQueryScope },
): Promise<CallListResponse> {
  const scope = options?.scope ?? 'page';
  const params = buildCallSearchParams(filters, page, pageSize, scope);
  return apiRequest<CallListResponse>(`/api/inside-sales/calls?${params.toString()}`);
}

export async function fetchCallsForSelection(
  filters: CallFilters,
  pageSize = 500,
): Promise<CallListResponse> {
  return fetchCalls(filters, 1, pageSize, { scope: 'all' });
}

export async function fetchLeads(
  filters: LeadFilters,
  page: number,
  pageSize: number,
): Promise<LeadListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const q = (filters.q ?? '').trim();
  if (filters.agents && filters.agents.length > 0) params.set('agents', filters.agents.join(','));
  if (filters.stage && filters.stage.length > 0) params.set('stage', filters.stage.join(','));
  if (filters.mqlMin) params.set('mql_min', filters.mqlMin);
  if (filters.condition && filters.condition.length > 0) params.set('condition', filters.condition.join(','));
  if (filters.city && filters.city.length > 0) params.set('city', filters.city.join(','));
  if (filters.leadId && filters.leadId.length > 0) params.set('lead_id', filters.leadId.join(','));
  if (filters.phone && filters.phone.length > 0) params.set('phone', filters.phone.join(','));
  if (filters.planName && filters.planName.length > 0) params.set('plan_name', filters.planName.join(','));
  if (q) params.set('q', q);

  return apiRequest<LeadListResponse>(`/api/inside-sales/leads?${params.toString()}`);
}

export async function fetchLeadDetail(
  leadId: string,
): Promise<LeadDetailFullResponse> {
  return apiRequest<LeadDetailFullResponse>(`/api/inside-sales/leads/${leadId}/detail`);
}
