/**
 * Phase 2 (sherlock-builder) — batch-mutation tests.
 *
 * The canvas-patch applier emits 7+ ops per "build me a concierge" prompt.
 * If `addNodes` / `addEdges` ran a hash recompute per-element, the React
 * commit cycle would re-render the canvas N times and the lifecycle pill
 * would briefly flash through intermediate states. The store batches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
} from '@/features/orchestration/types';

import * as snapshotHashModule from '@/features/orchestration/contracts/snapshotHash';

import { useWorkflowBuilderStore } from './workflowBuilderStore';

function fixtureNode(id: string): WorkflowDefinitionNode {
  return {
    id,
    type: 'sink.complete',
    position: { x: 0, y: 0 },
    config: {},
  } as WorkflowDefinitionNode;
}

function fixtureEdge(id: string, source: string, target: string): WorkflowDefinitionEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'default',
  } as WorkflowDefinitionEdge;
}

describe('workflowBuilderStore — batch mutations', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('addNodes appends every node and recomputes data hash exactly once', () => {
    const dataHashSpy = vi.spyOn(snapshotHashModule, 'dataSnapshotHash');
    const layoutHashSpy = vi.spyOn(snapshotHashModule, 'layoutSnapshotHash');

    const seven = Array.from({ length: 7 }, (_, i) => fixtureNode(`n_${i}`));
    useWorkflowBuilderStore.getState().addNodes(seven);

    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(7);
    expect(dataHashSpy).toHaveBeenCalledTimes(1);
    expect(layoutHashSpy).toHaveBeenCalledTimes(1);
  });

  it('addNodes is a no-op (no hash recompute) when given an empty array', () => {
    const dataHashSpy = vi.spyOn(snapshotHashModule, 'dataSnapshotHash');
    const before = useWorkflowBuilderStore.getState().currentDataHash;
    useWorkflowBuilderStore.getState().addNodes([]);
    expect(useWorkflowBuilderStore.getState().currentDataHash).toBe(before);
    expect(dataHashSpy).not.toHaveBeenCalled();
  });

  it('addEdges appends every edge and recomputes data hash exactly once', () => {
    useWorkflowBuilderStore.getState().addNodes([
      fixtureNode('a'),
      fixtureNode('b'),
      fixtureNode('c'),
    ]);

    const dataHashSpy = vi.spyOn(snapshotHashModule, 'dataSnapshotHash');
    const edges = [fixtureEdge('e1', 'a', 'b'), fixtureEdge('e2', 'b', 'c')];
    useWorkflowBuilderStore.getState().addEdges(edges);

    expect(useWorkflowBuilderStore.getState().edges).toHaveLength(2);
    expect(dataHashSpy).toHaveBeenCalledTimes(1);
  });

  it('addEdges is a no-op when given an empty array', () => {
    const dataHashSpy = vi.spyOn(snapshotHashModule, 'dataSnapshotHash');
    useWorkflowBuilderStore.getState().addEdges([]);
    expect(dataHashSpy).not.toHaveBeenCalled();
  });

  it('addNodes flips currentDataHash off the empty-canvas baseline', () => {
    const before = useWorkflowBuilderStore.getState().currentDataHash;
    useWorkflowBuilderStore.getState().addNodes([fixtureNode('only')]);
    const after = useWorkflowBuilderStore.getState().currentDataHash;
    expect(after).not.toBe(before);
  });
});
