import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NodeConfigPanel } from '@/features/orchestration/components/NodeConfigPanel';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type { NodeTypeDescriptor } from '@/features/orchestration/types';

function descriptor(
  override: Partial<NodeTypeDescriptor>,
): NodeTypeDescriptor {
  return {
    nodeType: override.nodeType ?? 'filter.eligibility',
    workflowType: '*',
    displayLabel: override.displayLabel ?? 'Eligibility Filter',
    displayCategory: override.displayCategory ?? 'qualification',
    description: override.description ?? '',
    authoringStatus: override.authoringStatus ?? 'active',
    configSchema: override.configSchema ?? {
      type: 'object',
      properties: { predicate: { type: 'object' } },
    },
    editorHints: override.editorHints ?? {},
    requiredPayloadFields: override.requiredPayloadFields ?? [],
    emittedPayloadFields: override.emittedPayloadFields ?? [],
    outputEdges: override.outputEdges ?? [],
    graphRules: override.graphRules ?? {},
    runtimeContract: override.runtimeContract ?? {
      executionKind: 'qualification',
    },
    category: override.category ?? 'filter',
    label: override.label ?? override.displayLabel ?? 'Eligibility Filter',
  };
}

describe('NodeConfigPanel — descriptor-driven rendering', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
  });

  it('renders the empty-state when no node is selected', () => {
    render(<NodeConfigPanel />);
    expect(
      screen.getByText('Select a node to edit its config.'),
    ).toBeInTheDocument();
  });

  it('uses PredicateBuilder for filter.eligibility', () => {
    const desc = descriptor({
      nodeType: 'filter.eligibility',
      editorHints: { preferredEditor: 'PredicateBuilder' },
    });
    const store = useWorkflowBuilderStore.getState();
    store.setPaletteCatalog([desc]);
    store.addNode({
      id: 'n1',
      type: 'filter.eligibility',
      position: { x: 0, y: 0 },
      data: { label: 'eligibility' },
      config: {},
    });
    store.setSelectedNode('n1');
    render(<NodeConfigPanel />);
    // PredicateBuilder shows the kind switcher.
    expect(screen.getByText('Leaf')).toBeInTheDocument();
    expect(screen.getByText('AND')).toBeInTheDocument();
  });

  it('uses WaitConditionEditor for logic.wait', () => {
    const desc = descriptor({
      nodeType: 'logic.wait',
      displayLabel: 'Wait Condition',
      editorHints: { preferredEditor: 'WaitConditionEditor' },
      runtimeContract: {
        executionKind: 'suspension',
        supportsSuspendResume: true,
      },
    });
    const store = useWorkflowBuilderStore.getState();
    store.setPaletteCatalog([desc]);
    store.addNode({
      id: 'n1',
      type: 'logic.wait',
      position: { x: 0, y: 0 },
      data: { label: 'wait' },
      config: { mode: 'duration', duration_hours: 4 },
    });
    store.setSelectedNode('n1');
    render(<NodeConfigPanel />);
    expect(screen.getByPlaceholderText('hours to wait')).toBeInTheDocument();
  });

  it('shows the hidden-node warning when authoringStatus=hidden', () => {
    const desc = descriptor({
      nodeType: 'filter.consent_gate',
      displayLabel: 'Consent Gate',
      authoringStatus: 'hidden',
      editorHints: {
        emptyStateMessage:
          'Author-only gate — surfaces context for existing definitions.',
      },
    });
    const store = useWorkflowBuilderStore.getState();
    store.setPaletteCatalog([desc]);
    store.addNode({
      id: 'n1',
      type: 'filter.consent_gate',
      position: { x: 0, y: 0 },
      data: { label: 'consent' },
      config: {},
    });
    store.setSelectedNode('n1');
    render(<NodeConfigPanel />);
    // Hidden warning banner.
    expect(
      screen.getByText(/This node is hidden from the palette/i),
    ).toBeInTheDocument();
    // Editor-hints empty-state message — distinct from the warning.
    expect(
      screen.getByText(/Author-only gate/i),
    ).toBeInTheDocument();
  });

  it('surfaces requiredPayloadFields and emittedPayloadFields from the descriptor', () => {
    const desc = descriptor({
      nodeType: 'crm.send_wati',
      displayLabel: 'WhatsApp Dispatch',
      displayCategory: 'dispatch',
      configSchema: { type: 'object', properties: {} },
      requiredPayloadFields: ['whatsapp_number'],
      emittedPayloadFields: ['wati_local_message_id'],
      runtimeContract: {
        executionKind: 'dispatch',
        supportsAttemptPolicy: true,
      },
      category: 'action',
    });
    const store = useWorkflowBuilderStore.getState();
    store.setPaletteCatalog([desc]);
    store.addNode({
      id: 'n1',
      type: 'crm.send_wati',
      position: { x: 0, y: 0 },
      data: { label: 'wati' },
      config: {},
    });
    store.setSelectedNode('n1');
    render(<NodeConfigPanel />);
    expect(screen.getByText('Requires payload fields')).toBeInTheDocument();
    expect(screen.getByText('whatsapp_number')).toBeInTheDocument();
    expect(screen.getByText('Emits payload fields')).toBeInTheDocument();
    expect(screen.getByText('wati_local_message_id')).toBeInTheDocument();
  });
});
