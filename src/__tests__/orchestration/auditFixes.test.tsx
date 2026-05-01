/**
 * Regression tests for the 2026-04-30 phase-1-6 audit findings — frontend half.
 *
 * Audit items covered:
 *   #9  source-node next_node_id derives from outgoing default edge at save.
 *   #10 logic.split outputEdges derived from config.branches[*].label.
 *   #11 DynamicConfigForm renders array<object> + array<string> editors.
 *   #12 toDefinition round-trips canvas.viewport, setViewport leaves dirty=false.
 *   #13 Run-Now / publish state UX disabled until publish.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DynamicConfigForm, type JsonSchema } from '@/features/orchestration/components/DynamicConfigForm';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

// Phase 11 (Commit 2): audit-#9 ``next_node_id`` auto-sync tests were
// removed — the backend normalizer strips ``next_node_id`` from saved
// definitions and the validator requires exactly one outgoing
// ``default`` edge on every ``source.*`` node, so writing the field from
// the frontend is no longer load-bearing. The store no longer exports
// ``isSourceNodeType`` / ``syncSourceNodeNextEdges``.

describe('source-node successor derives from outgoing edge (Phase 11 §6.1)', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
  });

  it('toDefinition does not write next_node_id into source node config', () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: 'src',
      type: 'source.cohort_query',
      position: { x: 0, y: 0 },
      data: { label: 'Source', nodeType: 'source.cohort_query' },
      config: { source_ref: 'crm.lead_record' },
    });
    s.addNode({
      id: 'tgt',
      type: 'sink.complete',
      position: { x: 0, y: 0 },
      data: { label: 'End', nodeType: 'sink.complete' },
      config: {},
    });
    s.addEdge({ id: 'e1', source: 'src', target: 'tgt', outputId: 'default' });
    const def = useWorkflowBuilderStore.getState().toDefinition();
    const src = def.nodes.find((n) => n.id === 'src');
    expect(src?.config).not.toHaveProperty('next_node_id');
  });
});

describe('audit #12 — viewport round-trip + non-dirty pan/zoom', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
  });

  it('setViewport does NOT mark draft dirty', () => {
    const s = useWorkflowBuilderStore.getState();
    expect(s.dirty).toBe(false);
    s.setViewport({ x: 100, y: 50, zoom: 1.5 });
    expect(useWorkflowBuilderStore.getState().dirty).toBe(false);
    expect(useWorkflowBuilderStore.getState().viewport).toEqual({
      x: 100,
      y: 50,
      zoom: 1.5,
    });
  });

  it('toDefinition includes canvas.viewport when set', () => {
    const s = useWorkflowBuilderStore.getState();
    s.setViewport({ x: 12, y: 34, zoom: 2 });
    const def = useWorkflowBuilderStore.getState().toDefinition();
    expect(def.canvas?.viewport).toEqual({ x: 12, y: 34, zoom: 2 });
  });

  it('hydrate from definition restores viewport and resets dirty', () => {
    const s = useWorkflowBuilderStore.getState();
    s.addNode({
      id: 'a',
      type: 'sink.complete',
      position: { x: 0, y: 0 },
      data: { label: 'A', nodeType: 'sink.complete' },
      config: {},
    });
    expect(useWorkflowBuilderStore.getState().dirty).toBe(true);
    s.hydrate({
      nodes: [],
      edges: [],
      canvas: { viewport: { x: 5, y: 6, zoom: 0.8 } },
    });
    const after = useWorkflowBuilderStore.getState();
    expect(after.dirty).toBe(false);
    expect(after.viewport).toEqual({ x: 5, y: 6, zoom: 0.8 });
  });
});

describe('audit #13 — publish state in store', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().reset();
  });

  it('store starts with currentPublishedVersionId=null', () => {
    expect(useWorkflowBuilderStore.getState().currentPublishedVersionId).toBeNull();
  });

  it('setMetadata updates currentPublishedVersionId when provided', () => {
    useWorkflowBuilderStore.getState().setMetadata({
      workflowId: 'w1',
      versionId: 'v1',
      name: 'X',
      workflowType: 'crm',
      currentPublishedVersionId: 'v1',
    });
    expect(useWorkflowBuilderStore.getState().currentPublishedVersionId).toBe('v1');
  });

  it('setMetadata leaves publish state alone when key omitted', () => {
    useWorkflowBuilderStore.getState().setCurrentPublishedVersionId('v-existing');
    useWorkflowBuilderStore.getState().setMetadata({
      workflowId: 'w1',
      versionId: 'v2',
      name: 'X',
      workflowType: 'crm',
    });
    expect(useWorkflowBuilderStore.getState().currentPublishedVersionId).toBe('v-existing');
  });
});

describe('audit #11 — DynamicConfigForm array editor', () => {
  it('renders an Add button for an array<object> property', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        branches: {
          type: 'array',
          title: 'Branches',
          items: {
            type: 'object',
            properties: { label: { type: 'string', title: 'Label' } },
            required: ['label'],
          },
        },
      },
    };
    const onChange = vi.fn();
    render(<DynamicConfigForm schema={schema} value={{}} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /Add/i })).toBeInTheDocument();
  });

  it('Add button appends a new empty entry to an array<object>', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        branches: {
          type: 'array',
          title: 'Branches',
          items: {
            type: 'object',
            properties: { label: { type: 'string', title: 'Label' } },
          },
        },
      },
    };
    const onChange = vi.fn();
    render(<DynamicConfigForm schema={schema} value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    expect(onChange).toHaveBeenLastCalledWith({ branches: [{}] });
  });

  it('renders a primitive array editor for array<string>', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        payload_columns: {
          type: 'array',
          title: 'Payload columns',
          items: { type: 'string' },
        },
      },
    };
    const onChange = vi.fn();
    render(
      <DynamicConfigForm
        schema={schema}
        value={{ payload_columns: ['mobile'] }}
        onChange={onChange}
      />,
    );
    // One row already → one Remove button + one Add button.
    expect(screen.getByRole('button', { name: /^Add$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Remove item/i })).toHaveLength(1);
  });

  it('honours hiddenFields — next_node_id is not rendered for source nodes', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        next_node_id: { type: 'string', title: 'Next node id' },
        source_table: { type: 'string', title: 'Source table' },
      },
    };
    const onChange = vi.fn();
    render(
      <DynamicConfigForm
        schema={schema}
        value={{}}
        onChange={onChange}
        hiddenFields={new Set(['next_node_id'])}
      />,
    );
    expect(screen.queryByLabelText(/Next node id/)).toBeNull();
    expect(screen.getByLabelText(/Source table/)).toBeInTheDocument();
  });
});
