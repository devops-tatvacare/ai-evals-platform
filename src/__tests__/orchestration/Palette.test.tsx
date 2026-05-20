import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Palette } from '@/features/orchestration/components/Palette';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

describe('Palette', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
    useWorkflowBuilderStore.getState().setPaletteCatalog([
      {
        nodeType: 'filter.eligibility',
        workflowType: '*',
        displayLabel: 'Eligibility',
        displayCategory: 'qualification',
        description: 'Predicate filter',
        authoringStatus: 'active',
        configSchema: { type: 'object', properties: {} },
        editorHints: {},
        requiredPayloadFields: [],
        emittedPayloadFields: [],
        outputEdges: [
          { id: 'passed', label: 'Passed', cardinality: 'one', dynamic: false },
          { id: 'skipped', label: 'Skipped', cardinality: 'one', dynamic: false },
        ],
        graphRules: {},
        runtimeContract: { executionKind: 'qualification' },
        category: 'filter',
        label: 'Eligibility',
      },
      {
        nodeType: 'filter.consent_gate',
        workflowType: '*',
        displayLabel: 'Consent Gate',
        displayCategory: 'qualification',
        description: 'Drops opted-out recipients',
        authoringStatus: 'hidden',
        configSchema: { type: 'object', properties: {} },
        editorHints: {},
        requiredPayloadFields: [],
        emittedPayloadFields: [],
        outputEdges: [
          { id: 'allowed', label: 'Allowed', cardinality: 'one', dynamic: false },
          { id: 'blocked', label: 'Blocked', cardinality: 'one', dynamic: false },
        ],
        graphRules: {},
        runtimeContract: { executionKind: 'qualification' },
        category: 'filter',
        label: 'Consent Gate',
      },
    ]);
  });

  it('hides consent gate from the authoring palette', () => {
    render(<Palette />);

    expect(screen.getByText('Eligibility')).toBeInTheDocument();
    expect(screen.queryByText('Consent Gate')).not.toBeInTheDocument();
  });

  it('groups by Phase 11 displayCategory with neutral labels', () => {
    useWorkflowBuilderStore.getState().setPaletteCatalog([
      {
        nodeType: 'core.webhook_out',
        workflowType: 'crm',
        displayLabel: 'WhatsApp Dispatch',
        displayCategory: 'dispatch',
        description: 'Send a WATI WhatsApp template',
        authoringStatus: 'active',
        configSchema: { type: 'object', properties: {} },
        editorHints: {},
        requiredPayloadFields: ['whatsapp_number'],
        emittedPayloadFields: ['wati_local_message_id'],
        outputEdges: [
          { id: 'success', label: 'Success', cardinality: 'one', dynamic: false },
          { id: 'exhausted', label: 'Exhausted', cardinality: 'one', dynamic: false },
        ],
        graphRules: {},
        runtimeContract: { executionKind: 'dispatch', supportsAttemptPolicy: true },
        category: 'action',
        label: 'WhatsApp Dispatch',
      },
      {
        nodeType: 'logic.split',
        workflowType: '*',
        displayLabel: 'Segment Split',
        displayCategory: 'routing',
        description: 'Direct recipients into branches',
        authoringStatus: 'active',
        configSchema: { type: 'object', properties: {} },
        editorHints: {},
        requiredPayloadFields: [],
        emittedPayloadFields: [],
        outputEdges: [],
        graphRules: {},
        runtimeContract: { executionKind: 'routing' },
        category: 'logic',
        label: 'Segment Split',
      },
    ]);
    render(<Palette />);
    // Neutral, professional category labels — not the legacy product
    // buckets ('Action' / 'Logic').
    expect(screen.getByText('Dispatch')).toBeInTheDocument();
    expect(screen.getByText('Routing')).toBeInTheDocument();
    expect(screen.queryByText('Action')).not.toBeInTheDocument();
    expect(screen.queryByText('Logic')).not.toBeInTheDocument();
  });
});
