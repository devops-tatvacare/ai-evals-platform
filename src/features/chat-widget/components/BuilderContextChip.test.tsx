import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PageContext } from '@/features/orchestration/copilot/usePageContext';

import { BuilderContextChip } from './BuilderContextChip';

function fixture(viewMode: 'view' | 'edit'): Extract<PageContext, { kind: 'orchestration_builder' }> {
  return {
    kind: 'orchestration_builder',
    workflowId: 'wf_demo',
    versionId: 'v_1',
    workflowType: 'crm',
    appId: 'inside-sales',
    selectedNodeId: 'webhook_out_1',
    workflowName: 'MQL Concierge',
    dataHash: 'abc1234567890def',
    viewMode,
    definition: {
      nodes: [
        {
          id: 'webhook_out_1',
          type: 'core.webhook_out',
          position: { x: 0, y: 0 },
          data: {},
          config: {},
        },
        {
          id: 'sink_1',
          type: 'sink.complete',
          position: { x: 100, y: 0 },
          data: {},
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'webhook_out_1',
          target: 'sink_1',
          output_id: 'success',
        },
      ],
    },
  };
}

describe('BuilderContextChip — collapsed', () => {
  it('renders the verb + workflow name + workflow-type badge in edit mode', () => {
    render(<BuilderContextChip pageContext={fixture('edit')} onDismiss={() => {}} />);
    expect(screen.getByText(/Editing: MQL Concierge/)).toBeInTheDocument();
    expect(screen.getByText('CRM')).toBeInTheDocument();
    expect(screen.getByTestId('builder-context-chip-dismiss')).toBeInTheDocument();
  });

  it('hides the dismiss button in view mode', () => {
    render(<BuilderContextChip pageContext={fixture('view')} onDismiss={() => {}} />);
    expect(screen.getByText(/Viewing: MQL Concierge/)).toBeInTheDocument();
    expect(screen.queryByTestId('builder-context-chip-dismiss')).toBeNull();
  });

  it('falls back to "Untitled workflow" when the name is blank', () => {
    const ctx = { ...fixture('edit'), workflowName: '   ' };
    render(<BuilderContextChip pageContext={ctx} onDismiss={() => {}} />);
    expect(screen.getByText(/Editing: Untitled workflow/)).toBeInTheDocument();
  });

  it('starts collapsed — details are not in the DOM', () => {
    render(<BuilderContextChip pageContext={fixture('edit')} onDismiss={() => {}} />);
    expect(screen.queryByTestId('builder-context-chip-details')).toBeNull();
  });
});

describe('BuilderContextChip — expand / collapse', () => {
  it('expands to show derived workflow / selection / canvas rows on header click', async () => {
    render(<BuilderContextChip pageContext={fixture('edit')} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-header'));

    const details = screen.getByTestId('builder-context-chip-details');
    expect(details).toBeInTheDocument();

    // Workflow row.
    expect(screen.getAllByText(/MQL Concierge/).length).toBeGreaterThanOrEqual(1);

    // Selection row — selected node type + id are derived from the
    // definition lookup, never hardcoded.
    expect(screen.getByText('core.webhook_out')).toBeInTheDocument();
    expect(screen.getByText('webhook_out_1')).toBeInTheDocument();

    // Canvas row — counts + hash prefix derived.
    expect(screen.getByText('2 nodes')).toBeInTheDocument();
    expect(screen.getByText('1 edge')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
  });

  it('shows "no selection" when nothing is selected', async () => {
    const ctx = { ...fixture('edit'), selectedNodeId: null };
    render(<BuilderContextChip pageContext={ctx} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-header'));
    expect(screen.getByText('no selection')).toBeInTheDocument();
  });

  it('singularises counts when the canvas has exactly one node and one edge', async () => {
    const ctx = {
      ...fixture('edit'),
      definition: {
        nodes: [fixture('edit').definition.nodes[0]],
        edges: [fixture('edit').definition.edges[0]],
      },
      selectedNodeId: null,
    };
    render(<BuilderContextChip pageContext={ctx} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-header'));
    expect(screen.getByText('1 node')).toBeInTheDocument();
    expect(screen.getByText('1 edge')).toBeInTheDocument();
  });

  it('renders a "switch to Edit" hint inside the details panel in view mode', async () => {
    render(<BuilderContextChip pageContext={fixture('view')} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-header'));
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
  });

  it('toggles back to collapsed on a second header click', async () => {
    render(<BuilderContextChip pageContext={fixture('edit')} onDismiss={() => {}} />);
    const header = screen.getByTestId('builder-context-chip-header');
    await userEvent.click(header);
    expect(screen.getByTestId('builder-context-chip-details')).toBeInTheDocument();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    // AnimatePresence runs an exit transition (~180ms) before unmount.
    // Wait for the details node to leave the DOM.
    await waitFor(() => {
      expect(screen.queryByTestId('builder-context-chip-details')).toBeNull();
    });
  });

  it('shows a "Switch to Edit" action in view mode that flips the store viewMode', async () => {
    const { useWorkflowBuilderStore } = await import(
      '@/features/orchestration/store/workflowBuilderStore'
    );
    useWorkflowBuilderStore.getState().reset();
    useWorkflowBuilderStore.getState().setMetadata({
      workflowId: 'wf_demo',
      versionId: 'v_1',
      name: 'MQL Concierge',
      workflowType: 'crm',
    });
    useWorkflowBuilderStore.getState().setViewMode('view');

    render(<BuilderContextChip pageContext={fixture('view')} onDismiss={() => {}} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-header'));
    const switchBtn = screen.getByTestId('builder-context-chip-switch-to-edit');
    await userEvent.click(switchBtn);

    expect(useWorkflowBuilderStore.getState().viewMode).toBe('edit');
  });

  it('dismiss button does NOT toggle expand (stopPropagation)', async () => {
    const onDismiss = vi.fn();
    render(<BuilderContextChip pageContext={fixture('edit')} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('builder-context-chip-details')).toBeNull();
  });
});
