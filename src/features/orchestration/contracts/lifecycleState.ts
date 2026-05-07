import type { ApiErrorBody } from './errorDecoder';

/**
 * Phase 14 — derived lifecycle for the workflow builder.
 *
 * The pre-Phase-14 store collapsed everything into a single `dirty: boolean`,
 * which made it impossible to distinguish:
 *   - "draft, never saved"             vs. "draft with unsaved edits"
 *   - "published with no pending edit" vs. "published with pending edits"
 *   - "saving in progress"             vs. "save just failed"
 *
 * The header pill, save/publish button states, and toast text now read
 * `useLifecycleState()` (a derived selector over the store). Every visible
 * state is one branch of this discriminated union.
 */

export type SaveOutcome =
  | { status: 'ok'; at: number }
  | { status: 'fail'; at: number; error: ApiErrorBody };

export type PublishOutcome =
  | { status: 'ok'; at: number }
  | { status: 'fail'; at: number; error: ApiErrorBody };

export type InFlight = 'idle' | 'saving' | 'publishing';

export interface LifecycleInputs {
  /** True when there is no published version on this workflow yet. */
  hasPublishedVersion: boolean;
  /** Hash of the most recently committed (saved or hydrated) data snapshot.
   *  `null` only before first hydrate. */
  committedDataHash: string | null;
  /** Hash of the live, in-store data snapshot. */
  currentDataHash: string;
  /** Hash of the most recently committed layout (positions). Layout changes
   *  do NOT drive `dirty-published-edits` — see snapshotHash.ts rationale. */
  committedLayoutHash: string | null;
  /** Hash of the live, in-store layout snapshot. */
  currentLayoutHash: string;
  inFlight: InFlight;
  lastSaveOutcome: SaveOutcome | null;
  lastPublishOutcome: PublishOutcome | null;
}

export type LifecycleState =
  | { kind: 'saving' }
  | { kind: 'publishing' }
  | { kind: 'save-failed'; error: ApiErrorBody }
  | { kind: 'publish-failed'; error: ApiErrorBody }
  | { kind: 'clean-draft' }
  | { kind: 'dirty-draft' }
  | { kind: 'clean-published' }
  | { kind: 'dirty-published-edits' };

/** Pure: lifecycle is a function of inputs. No I/O, no time, no random.
 *  Tested with explicit input rows. */
export function deriveLifecycleState(input: LifecycleInputs): LifecycleState {
  // In-flight always wins — UI must not advertise "clean" while a write is
  // mid-air, and must never re-show stale failure once the user retries.
  if (input.inFlight === 'saving') return { kind: 'saving' };
  if (input.inFlight === 'publishing') return { kind: 'publishing' };

  // A failure that hasn't been superseded by a successful subsequent attempt
  // takes precedence over the dirty/clean view. The store is responsible for
  // clearing the outcome on the next attempt.
  if (
    input.lastPublishOutcome?.status === 'fail' &&
    !isLaterOutcomeOk(input.lastPublishOutcome.at, input.lastSaveOutcome)
  ) {
    return { kind: 'publish-failed', error: input.lastPublishOutcome.error };
  }
  if (input.lastSaveOutcome?.status === 'fail') {
    return { kind: 'save-failed', error: input.lastSaveOutcome.error };
  }

  const dataDirty = input.committedDataHash !== input.currentDataHash;

  if (!input.hasPublishedVersion) {
    return dataDirty ? { kind: 'dirty-draft' } : { kind: 'clean-draft' };
  }
  return dataDirty
    ? { kind: 'dirty-published-edits' }
    : { kind: 'clean-published' };
}

function isLaterOutcomeOk(
  publishFailedAt: number,
  saveOutcome: SaveOutcome | null,
): boolean {
  // Reserved for future "publish failed but a subsequent save succeeded"
  // disambiguation. Today: a publish failure stays sticky until the next
  // publish attempt clears it.
  if (!saveOutcome) return false;
  return saveOutcome.status === 'ok' && saveOutcome.at > publishFailedAt
    ? false
    : false;
}

/** Whether the Save button should be enabled in the header. */
export function canSave(state: LifecycleState, inFlight: InFlight): boolean {
  if (inFlight !== 'idle') return false;
  return (
    state.kind === 'dirty-draft' ||
    state.kind === 'dirty-published-edits' ||
    state.kind === 'save-failed' ||
    state.kind === 'publish-failed'
  );
}

/** Whether the Publish button should be enabled in the header. */
export function canPublish(state: LifecycleState, inFlight: InFlight): boolean {
  if (inFlight !== 'idle') return false;
  // Publish is allowed from any non-in-flight state; the backend validator
  // remains the authority on whether the content is publishable.
  return state.kind !== 'saving' && state.kind !== 'publishing';
}

/** Header pill copy. Centralised here so the same text reaches every
 *  surface (header, leave-confirm dialog, accessibility labels). */
export function pillLabel(state: LifecycleState): string {
  switch (state.kind) {
    case 'saving':
      return 'Saving…';
    case 'publishing':
      return 'Publishing…';
    case 'save-failed':
      return 'Save failed';
    case 'publish-failed':
      return 'Publish failed';
    case 'clean-draft':
      return 'Draft';
    case 'dirty-draft':
      return 'Draft (unsaved)';
    case 'clean-published':
      return 'Published';
    case 'dirty-published-edits':
      return 'Published · unsaved edits';
  }
}
