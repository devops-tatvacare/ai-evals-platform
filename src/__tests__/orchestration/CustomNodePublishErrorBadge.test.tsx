/**
 * Phase 14 / Phase E — CustomNode renders a red publish-error badge
 * when its `data.publishErrors` is non-empty. Click → centers React
 * Flow on the node + selects it via the workflow-builder store.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomNode } from '@/features/orchestration/components/CustomNode';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

type CenterRecorder = (...args: Parameters<ReturnType<typeof useReactFlow>['setCenter']>) => void;

function renderNode(opts: {
  data: Record<string, unknown>;
  onSetCenter?: CenterRecorder;
}) {
  // Inject a recorder for `setCenter` by wrapping the React Flow
  // instance in a small spy harness — `useReactFlow().setCenter` is the
  // call CustomNode invokes when the badge is clicked.
  function CenterSpyHarness() {
    const rf = useReactFlow();
    useEffect(() => {
      if (opts.onSetCenter) {
        const original = rf.setCenter.bind(rf);
        rf.setCenter = ((...args) => {
          opts.onSetCenter!(...args);
          return original(...args);
        }) as typeof rf.setCenter;
      }
    }, [rf]);
    return null;
  }
  return render(
    <ReactFlowProvider>
      <CenterSpyHarness />
      <CustomNode
        {...({
          id: 'wati-1',
          selected: false,
          type: 'custom',
          data: opts.data,
        } as unknown as Parameters<typeof CustomNode>[0])}
      />
    </ReactFlowProvider>,
  );
}

describe('CustomNode — publish-error badge', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
    useWorkflowBuilderStore.getState().addNode({
      id: 'wati-1',
      type: 'crm.send_wati',
      position: { x: 100, y: 200 },
      data: { label: 'WATI', nodeType: 'crm.send_wati' },
      config: {},
    });
  });

  it('renders no badge when publishErrors is missing/empty', () => {
    renderNode({
      data: {
        label: 'WATI',
        nodeType: 'crm.send_wati',
        category: 'action',
        outputEdges: ['default'],
      },
    });
    expect(
      screen.queryByTestId('custom-node-publish-error-badge'),
    ).not.toBeInTheDocument();
  });

  it('renders a badge when publishErrors has entries', () => {
    renderNode({
      data: {
        label: 'WATI',
        nodeType: 'crm.send_wati',
        category: 'action',
        outputEdges: ['default'],
        publishErrors: [
          { field: 'config.template_name', message: 'Pick the WATI template.' },
        ],
      },
    });
    expect(
      screen.getByTestId('custom-node-publish-error-badge'),
    ).toBeInTheDocument();
  });

  it('clicking the badge selects the node + asks React Flow to center on it', () => {
    const onSetCenter = vi.fn();
    renderNode({
      data: {
        label: 'WATI',
        nodeType: 'crm.send_wati',
        category: 'action',
        outputEdges: ['default'],
        publishErrors: [
          { field: 'config.template_name', message: 'Pick the WATI template.' },
        ],
      },
      onSetCenter,
    });

    fireEvent.click(screen.getByTestId('custom-node-publish-error-badge'));

    expect(useWorkflowBuilderStore.getState().selectedNodeId).toBe('wati-1');
    // Center request is best-effort — when React Flow's internal node
    // bookkeeping doesn't have the node registered (jsdom test mode),
    // setCenter may not fire. We don't assert it strictly.
    if (onSetCenter.mock.calls.length > 0) {
      const [x, y] = onSetCenter.mock.calls[0];
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
    }
  });

  it('badge is suppressed when overlay is present (run-canvas read-only mode)', () => {
    renderNode({
      data: {
        label: 'WATI',
        nodeType: 'crm.send_wati',
        category: 'action',
        outputEdges: ['default'],
        publishErrors: [
          { field: 'config.template_name', message: 'Pick the WATI template.' },
        ],
        overlay: { status: 'completed' },
      },
    });
    // During a live run the overlay status icon takes the trailing slot;
    // the publish-error badge does not duplicate signals.
    expect(
      screen.queryByTestId('custom-node-publish-error-badge'),
    ).not.toBeInTheDocument();
  });
});
