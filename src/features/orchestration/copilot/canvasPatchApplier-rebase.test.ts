/**
 * Phase 3 Step 6 — rebase-redo flow tests.
 *
 * The hash-mismatch path now caches the patch's rationale on a
 * module-level pending-rebase slot. When the user replies with a redo
 * trigger ("yes, redo"), the chat widget calls `consumeRebaseRedo` and
 * substitutes a synthetic prompt carrying the cached rationale verbatim
 * before dispatching the next turn. The original user text remains
 * visible in the chat thread above.
 *
 * Coverage:
 *   - hash mismatch caches the rationale and posts the rebase prompt once
 *   - "yes, redo" reply produces a synthetic rebase prompt with the
 *     rationale embedded
 *   - any other reply discards the pending state with no synthetic
 *   - successful re-apply clears the pending state so the next mismatch
 *     starts fresh
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

import {
  _resetRebaseStateForTests,
  applyCanvasPatch,
  consumeRebaseRedo,
} from './canvasPatchApplier';

// Empty config is the draft-default for partial authoring — every node
// schema permits it under ``parseNodeConfig({mode: 'draft'})``. The applier
// re-validates every add_node config; a fabricated key (the previous fixture
// value) is now rejected as ``config_invalid``.
const VALID_CONFIG = {};

function fixturePatch(baseHash: string, rationale: string) {
  return {
    workflow_id: 'wf_demo',
    version_id: null,
    base_data_hash: baseHash,
    rationale,
    ops: [
      {
        op: 'add_node',
        node_id: 'n_a',
        payload: { node_type: 'sink.complete', config: {} },
      },
      {
        op: 'add_node',
        node_id: 'n_c',
        payload: {
          node_type: 'source.event_trigger',
          config: VALID_CONFIG,
        },
      },
    ],
  };
}

describe('canvasPatchApplier — rebase redo flow', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
    _resetRebaseStateForTests();
    vi.restoreAllMocks();
  });

  it('reports hash mismatch once and primes pending-rebase with the rationale', async () => {
    const onChatMessage = vi.fn();

    const result = await applyCanvasPatch(
      fixturePatch('stale-hash', 'add cohort + sink chain'),
      { onChatMessage, staggerMs: 0 },
    );

    expect(result.kind).toBe('hash_mismatch');
    expect(onChatMessage).toHaveBeenCalledTimes(1);
    expect(onChatMessage.mock.calls[0][0]).toContain('changed while I was working');

    // The hash-mismatch primes the rebase slot — a redo trigger now
    // produces the synthetic.
    const synthetic = consumeRebaseRedo('yes, redo');
    expect(synthetic).not.toBeNull();
    expect(synthetic).toContain('add cohort + sink chain');
    expect(synthetic).toContain('Re-read current state');
  });

  it('matches multiple redo-trigger phrasings (case-insensitive)', async () => {
    const triggers = ['yes, redo', 'YES, REDO', 'Yes Redo', 'redo'];
    for (const trigger of triggers) {
      _resetRebaseStateForTests();
      await applyCanvasPatch(
        fixturePatch('stale-hash', 'rationale-A'),
        { onChatMessage: vi.fn(), staggerMs: 0 },
      );
      const synthetic = consumeRebaseRedo(trigger);
      expect(synthetic, `trigger=${trigger}`).not.toBeNull();
      expect(synthetic).toContain('rationale-A');
    }
  });

  it('discards pending-rebase silently when the user replies with anything else', async () => {
    await applyCanvasPatch(
      fixturePatch('stale-hash', 'rationale-B'),
      { onChatMessage: vi.fn(), staggerMs: 0 },
    );

    const synthetic = consumeRebaseRedo('actually, never mind');
    expect(synthetic).toBeNull();

    // Pending was cleared — a follow-up "yes, redo" no longer fires.
    const second = consumeRebaseRedo('yes, redo');
    expect(second).toBeNull();
  });

  it('returns null when no rebase is pending', () => {
    expect(consumeRebaseRedo('yes, redo')).toBeNull();
    expect(consumeRebaseRedo('anything')).toBeNull();
  });

  it('hash mismatch is reported once and cleared after a fresh apply', async () => {
    // First call: stale hash → mismatch.
    const onChatMessage = vi.fn();
    await applyCanvasPatch(
      fixturePatch('stale-hash', 'rationale-C'),
      { onChatMessage, staggerMs: 0 },
    );
    expect(onChatMessage).toHaveBeenCalledTimes(1);

    // Second call: matching hash → applies cleanly. The pending slot
    // must clear so a future mismatch starts fresh.
    const baseHash = useWorkflowBuilderStore.getState().currentDataHash;
    const result = await applyCanvasPatch(
      fixturePatch(baseHash, 'rationale-D'),
      { onChatMessage: vi.fn(), staggerMs: 0 },
    );
    expect(result.kind).toBe('applied');

    // After a successful apply, "yes, redo" no longer rewrites — the
    // earlier mismatch is fully resolved.
    expect(consumeRebaseRedo('yes, redo')).toBeNull();
  });

  it('most recent rationale wins when multiple mismatches stack', async () => {
    await applyCanvasPatch(
      fixturePatch('stale-hash', 'first-attempt'),
      { onChatMessage: vi.fn(), staggerMs: 0 },
    );
    await applyCanvasPatch(
      fixturePatch('still-stale', 'second-attempt'),
      { onChatMessage: vi.fn(), staggerMs: 0 },
    );

    const synthetic = consumeRebaseRedo('yes, redo');
    expect(synthetic).toContain('second-attempt');
    expect(synthetic).not.toContain('first-attempt');
  });
});
