export type ReviewDecision = 'accept' | 'reject' | 'correct';
export type ReviewStatus = 'draft' | 'final';

export interface ReviewEvidenceEntry {
  label: string;
  value: string | string[] | Record<string, unknown> | null;
  kind: 'text' | 'list' | 'json';
}

export interface ReviewableAttribute {
  key: string;
  label: string;
  originalValue: string | null;
  allowedValues: string[];
  group?: string | null;
  sourceLabel?: string | null;
  description?: string | null;
  evidence?: string | null;
}

export interface ReviewableItem {
  itemKey: string;
  itemType: string;
  title: string;
  subtitle: string | null;
  badges: string[];
  evidence: ReviewEvidenceEntry[];
  attributes: ReviewableAttribute[];
}

export interface ReviewItemRecord {
  id: string;
  itemKey: string;
  itemType: string;
  attributeKey: string;
  decision: ReviewDecision;
  originalValue: string | null;
  reviewedValue: string | null;
  reasonCode: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalReviewSummary {
  id: string;
  runId: string;
  reviewerUserId: string;
  reviewerName: string | null;
  status: ReviewStatus;
  overallDecision: string | null;
  notes: string | null;
  reviewSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EvalReviewDetail extends EvalReviewSummary {
  items: ReviewItemRecord[];
}

export interface ActiveDraftInfo {
  reviewId: string;
  reviewerUserId: string;
  reviewerName: string | null;
  startedAt: string;
  isMine: boolean;
}

export interface RunReviewContext {
  runId: string;
  appId: string;
  adapter: string;
  itemTypes: string[];
  latestReviewId: string | null;
  draftReviewId: string | null;
  activeDraft: ActiveDraftInfo | null;
  items: ReviewableItem[];
  history: EvalReviewSummary[];
}

export interface ReviewItemUpsert {
  itemKey: string;
  itemType: string;
  attributeKey: string;
  decision: ReviewDecision;
  originalValue: string | null;
  reviewedValue: string | null;
  reasonCode: string | null;
  note: string | null;
}

export interface ReviewDraftUpdate {
  notes: string;
  items: ReviewItemUpsert[];
}
