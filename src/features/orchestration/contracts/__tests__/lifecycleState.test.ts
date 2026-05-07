import { describe, expect, it } from 'vitest';

import {
  canPublish,
  canSave,
  deriveLifecycleState,
  pillLabel,
  type LifecycleInputs,
} from '../lifecycleState';

const baseClean = (overrides: Partial<LifecycleInputs> = {}): LifecycleInputs => ({
  hasPublishedVersion: false,
  committedDataHash: 'h0',
  currentDataHash: 'h0',
  committedLayoutHash: 'l0',
  currentLayoutHash: 'l0',
  inFlight: 'idle',
  lastSaveOutcome: null,
  lastPublishOutcome: null,
  ...overrides,
});

describe('deriveLifecycleState', () => {
  it('clean-draft when never published and snapshots match', () => {
    expect(deriveLifecycleState(baseClean()).kind).toBe('clean-draft');
  });

  it('dirty-draft when never published and data hash diverges', () => {
    expect(
      deriveLifecycleState(
        baseClean({ currentDataHash: 'h1' }),
      ).kind,
    ).toBe('dirty-draft');
  });

  it('clean-published when published and snapshots match', () => {
    expect(
      deriveLifecycleState(baseClean({ hasPublishedVersion: true })).kind,
    ).toBe('clean-published');
  });

  it('dirty-published-edits when published and data hash diverges', () => {
    expect(
      deriveLifecycleState(
        baseClean({
          hasPublishedVersion: true,
          currentDataHash: 'h1',
        }),
      ).kind,
    ).toBe('dirty-published-edits');
  });

  it('LAYOUT-only divergence does NOT flip to dirty-published-edits', () => {
    expect(
      deriveLifecycleState(
        baseClean({
          hasPublishedVersion: true,
          currentLayoutHash: 'l1', // diverged
        }),
      ).kind,
    ).toBe('clean-published');
  });

  it('saving wins over dirty status', () => {
    expect(
      deriveLifecycleState(
        baseClean({
          inFlight: 'saving',
          currentDataHash: 'h1',
        }),
      ).kind,
    ).toBe('saving');
  });

  it('publishing wins over clean status', () => {
    expect(
      deriveLifecycleState(
        baseClean({ inFlight: 'publishing', hasPublishedVersion: true }),
      ).kind,
    ).toBe('publishing');
  });

  it('save-failed surfaces when last save outcome is fail and not in flight', () => {
    const state = deriveLifecycleState(
      baseClean({
        lastSaveOutcome: {
          status: 'fail',
          at: 100,
          error: { kind: 'message', message: 'boom' },
        },
      }),
    );
    expect(state.kind).toBe('save-failed');
    if (state.kind === 'save-failed') {
      expect(state.error).toEqual({ kind: 'message', message: 'boom' });
    }
  });

  it('publish-failed takes precedence over save-failed', () => {
    const state = deriveLifecycleState(
      baseClean({
        lastSaveOutcome: {
          status: 'fail',
          at: 90,
          error: { kind: 'message', message: 'save-fail' },
        },
        lastPublishOutcome: {
          status: 'fail',
          at: 100,
          error: { kind: 'message', message: 'publish-fail' },
        },
      }),
    );
    expect(state.kind).toBe('publish-failed');
  });
});

describe('canSave / canPublish', () => {
  it('canSave only when dirty (or after a failure)', () => {
    expect(canSave({ kind: 'clean-draft' }, 'idle')).toBe(false);
    expect(canSave({ kind: 'dirty-draft' }, 'idle')).toBe(true);
    expect(canSave({ kind: 'dirty-published-edits' }, 'idle')).toBe(true);
    expect(canSave({ kind: 'clean-published' }, 'idle')).toBe(false);
  });

  it('canSave is false while in flight', () => {
    expect(canSave({ kind: 'dirty-draft' }, 'saving')).toBe(false);
  });

  it('canPublish is false while in flight, true otherwise', () => {
    expect(canPublish({ kind: 'clean-draft' }, 'idle')).toBe(true);
    expect(canPublish({ kind: 'clean-draft' }, 'publishing')).toBe(false);
  });
});

describe('pillLabel', () => {
  it('uses the audit-revision-approved copy for the dirty-published case', () => {
    expect(pillLabel({ kind: 'dirty-published-edits' })).toBe(
      'Published · unsaved edits',
    );
  });
  it('uses Draft (unsaved) for never-published dirty drafts', () => {
    expect(pillLabel({ kind: 'dirty-draft' })).toBe('Draft (unsaved)');
  });
});
