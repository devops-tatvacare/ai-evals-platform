import { describe, expect, it, beforeEach } from 'vitest';

import { useRunOverlayStore } from '@/features/orchestration/store/runOverlayStore';

describe('runOverlayStore', () => {
  beforeEach(() => useRunOverlayStore.getState().reset());

  it('activateRun scopes state to a run id', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    expect(useRunOverlayStore.getState().runId).toBe('run-1');
    expect(useRunOverlayStore.getState().hydrated).toBe(false);
  });

  it('node_step.started records running status with cohort size', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'node_step.started',
      node_id: 'n1',
      input_cohort_size: 7,
    });
    const node = useRunOverlayStore.getState().byNodeId.n1;
    expect(node).toBeDefined();
    expect(node.status).toBe('running');
    expect(node.inputCohortSize).toBe(7);
  });

  it('node_step.completed overrides running and preserves cohort size', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'node_step.started',
      node_id: 'n1',
      input_cohort_size: 5,
    });
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'node_step.completed',
      node_id: 'n1',
      outputs_summary: { x: 1 },
    });
    const node = useRunOverlayStore.getState().byNodeId.n1;
    expect(node.status).toBe('completed');
    expect(node.outputsSummary).toEqual({ x: 1 });
    expect(node.inputCohortSize).toBe(5);
  });

  it('node_step.failed records error', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'node_step.failed',
      node_id: 'n1',
      error: 'RuntimeError(boom)',
    });
    const node = useRunOverlayStore.getState().byNodeId.n1;
    expect(node.status).toBe('failed');
    expect(node.error).toBe('RuntimeError(boom)');
  });

  it('run lifecycle events update runStatus', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-1', { type: 'run.started' });
    expect(useRunOverlayStore.getState().runStatus).toBe('running');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'run.completed',
      status: 'completed',
    });
    expect(useRunOverlayStore.getState().runStatus).toBe('completed');
  });

  it('run.failed sets failed', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'run.failed',
      error: 'x',
    });
    expect(useRunOverlayStore.getState().runStatus).toBe('failed');
  });

  it('unknown events are ignored', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'random.unknown',
      node_id: 'n1',
    });
    expect(useRunOverlayStore.getState().byNodeId).toEqual({});
  });

  it('hydrateSnapshot seeds the run and node state deterministically', () => {
    useRunOverlayStore.getState().hydrateSnapshot('run-1', {
      run: {
        id: 'run-1',
        workflowId: 'wf-1',
        workflowVersionId: 'wv-1',
        triggeredBy: 'manual',
        triggeredByUserId: null,
        status: 'waiting',
        cohortSizeAtEntry: 12,
        startedAt: null,
        completedAt: null,
        error: null,
        params: {},
        createdAt: '2026-05-04T00:00:00Z',
      },
      nodeSteps: [
        {
          id: 'step-1',
          nodeId: 'n1',
          nodeType: 'logic.wait',
          status: 'completed',
          inputsSummary: { cohort_size: 12 },
          outputsSummary: { by_output_id: { wakeup: 12 } },
          error: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    });
    expect(useRunOverlayStore.getState().runId).toBe('run-1');
    expect(useRunOverlayStore.getState().hydrated).toBe(true);
    expect(useRunOverlayStore.getState().runStatus).toBe('waiting');
    expect(useRunOverlayStore.getState().byNodeId.n1).toEqual({
      status: 'completed',
      inputCohortSize: 12,
      outputsSummary: { by_output_id: { wakeup: 12 } },
      error: undefined,
    });
  });

  it('ignores stale events from another run', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().applyEvent('run-2', {
      type: 'node_step.started',
      node_id: 'n1',
    });
    expect(useRunOverlayStore.getState().byNodeId).toEqual({});
  });

  it('reset clears all state including stream status and run id', () => {
    useRunOverlayStore.getState().activateRun('run-1');
    useRunOverlayStore.getState().setStreamStatus('run-1', 'open');
    useRunOverlayStore.getState().applyEvent('run-1', {
      type: 'node_step.started',
      node_id: 'n1',
    });
    useRunOverlayStore.getState().reset();
    expect(useRunOverlayStore.getState().byNodeId).toEqual({});
    expect(useRunOverlayStore.getState().streamStatus).toBe('idle');
    expect(useRunOverlayStore.getState().runStatus).toBe('pending');
    expect(useRunOverlayStore.getState().runId).toBeNull();
  });
});
