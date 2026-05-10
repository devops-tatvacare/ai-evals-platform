import { render, screen } from '@testing-library/react';
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
    selectedNodeId: 'send_wati_1',
    workflowName: 'MQL Concierge',
    dataHash: 'abc1234567890def',
    viewMode,
    definition: {
      nodes: [
        {
          id: 'send_wati_1',
          type: 'crm.send_wati',
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
          source: 'send_wati_1',
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
    expect(screen.getByText('crm.send_wati')).toBeInTheDocument();
    expect(screen.getByText('send_wati_1')).toBeInTheDocument();

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
    // After the second click the chip is collapsed; aria-expanded flips back
    // and the details panel is no longer in the DOM. AnimatePresence may
    // briefly retain the node during exit, so the userEvent click delay is
    // enough — query is enough, no waitForElementToBeRemoved needed.
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('builder-context-chip-details')).toBeNull();
  });

  it('dismiss button does NOT toggle expand (stopPropagation)', async () => {
    const onDismiss = vi.fn();
    render(<BuilderContextChip pageContext={fixture('edit')} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByTestId('builder-context-chip-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('builder-context-chip-details')).toBeNull();
  });
});
