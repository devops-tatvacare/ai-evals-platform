import { describe, expect, it } from 'vitest';

import {
  CANVAS_PATCH_CONTRACT_ID,
  CanvasPatchSchema,
  parseCanvasPatch,
} from './canvasPatchSchema';

describe('canvasPatchSchema', () => {
  it('exposes the v1 contract id', () => {
    expect(CANVAS_PATCH_CONTRACT_ID).toBe('orchestration.canvas_patch.v1');
  });

  it('parses a multi-op patch with every op kind', () => {
    const raw = {
      workflow_id: 'wf_123',
      version_id: null,
      base_data_hash: 'h_abc',
      rationale: 'demo',
      ops: [
        {
          op: 'add_node',
          node_id: 'n_source',
          payload: {
            node_type: 'source.dataset',
            config: { dataset_version_id: 'd_1' },
          },
        },
        {
          op: 'update_node_config',
          node_id: 'n_source',
          payload: { config_patch: { name: 'Leads 24h' } },
        },
        {
          op: 'connect',
          node_id: 'n_source',
          payload: {
            source_node_id: 'n_source',
            output_id: 'default',
            target_node_id: 'n_sink',
            edge_id: 'e1',
          },
        },
        {
          op: 'remove_node',
          node_id: 'n_old',
          payload: {},
        },
      ],
    };

    const result = parseCanvasPatch(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workflow_id).toBe('wf_123');
    expect(result.data.ops).toHaveLength(4);
    expect(result.data.ops[0].op).toBe('add_node');
    expect(result.data.ops[3].op).toBe('remove_node');
  });

  it('defaults ops, rationale, version_id when absent', () => {
    const result = parseCanvasPatch({
      workflow_id: 'wf_1',
      base_data_hash: 'h',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ops).toEqual([]);
    expect(result.data.rationale).toBe('');
    expect(result.data.version_id).toBeNull();
  });

  it('rejects an unknown op kind', () => {
    const result = parseCanvasPatch({
      workflow_id: 'wf_1',
      base_data_hash: 'h',
      ops: [{ op: 'fly_node', node_id: 'n', payload: {} }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects extra top-level keys', () => {
    const result = CanvasPatchSchema.safeParse({
      workflow_id: 'wf_1',
      base_data_hash: 'h',
      ops: [],
      rogue_field: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('rejects add_node with missing node_type', () => {
    const result = parseCanvasPatch({
      workflow_id: 'wf_1',
      base_data_hash: 'h',
      ops: [
        {
          op: 'add_node',
          node_id: 'n',
          payload: { config: {} },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects connect with empty edge_id', () => {
    const result = parseCanvasPatch({
      workflow_id: 'wf_1',
      base_data_hash: 'h',
      ops: [
        {
          op: 'connect',
          node_id: 'n',
          payload: {
            source_node_id: 's',
            output_id: 'default',
            target_node_id: 't',
            edge_id: '',
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});
