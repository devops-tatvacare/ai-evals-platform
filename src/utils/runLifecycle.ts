import type { EvalRunLifecycleStatus, RunStatus } from '@/types';

// Accepts every shape a run status arrives in:
// - `EvalRunLifecycleStatus` (lowercase, modern EvalRun rows)
// - `RunStatus` (uppercase, legacy batch/adversarial rows)
// - bare `string` for routes that haven't typed the value yet
export type AnyRunStatus = EvalRunLifecycleStatus | RunStatus | string;

export const normalizeRunStatus = (status: AnyRunStatus): string =>
  status.toLowerCase();

const ACTIVE_STATUSES = new Set(['running', 'pending']);
const TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'interrupted',
]);
const REVIEWABLE_STATUSES = new Set(['completed', 'completed_with_errors']);

export function isActive(status: AnyRunStatus): boolean {
  return ACTIVE_STATUSES.has(normalizeRunStatus(status));
}

export function isTerminal(status: AnyRunStatus): boolean {
  return TERMINAL_STATUSES.has(normalizeRunStatus(status));
}

export function isReviewable(status: AnyRunStatus): boolean {
  return REVIEWABLE_STATUSES.has(normalizeRunStatus(status));
}

// Intent-revealing alias: "the Report tab is meaningful for this status."
export const hasReportableRun = isReviewable;

export function hasBrowsableResults(
  status: AnyRunStatus,
  resultCount: number,
): boolean {
  return isTerminal(status) && resultCount > 0;
}
