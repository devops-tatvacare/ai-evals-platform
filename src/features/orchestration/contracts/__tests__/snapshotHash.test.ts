import { describe, expect, it } from 'vitest';

import type {
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
} from '@/features/orchestration/types';
import { dataSnapshotHash, layoutSnapshotHash } from '../snapshotHash';

const node = (
  id: string,
  pos: { x: number; y: number },
  config: Record<string, unknown> = {},
): WorkflowDefinitionNode => ({
  id,
  type: 'sink.complete',
  position: pos,
  data: { label: id, nodeType: 'sink.complete' },
  config,
});

const edge = (
  id: string,
  source: string,
  target: string,
  outputId = 'default',
): WorkflowDefinitionEdge => ({ id, source, target, output_id: outputId });

describe('dataSnapshotHash', () => {
  it('is stable under node order permutation', () => {
    const nodes = [node('a', { x: 0, y: 0 }), node('b', { x: 1, y: 1 })];
    const reversed = [...nodes].reverse();
    expect(dataSnapshotHash(nodes, [])).toBe(dataSnapshotHash(reversed, []));
  });

  it('is stable under config key order', () => {
    const a = [node('n', { x: 0, y: 0 }, { a: 1, b: 2 })];
    const b = [node('n', { x: 0, y: 0 }, { b: 2, a: 1 })];
    expect(dataSnapshotHash(a, [])).toBe(dataSnapshotHash(b, []));
  });

  it('IGNORES position changes', () => {
    const a = [node('n', { x: 0, y: 0 })];
    const b = [node('n', { x: 999, y: 999 })];
    expect(dataSnapshotHash(a, [])).toBe(dataSnapshotHash(b, []));
  });

  it('reflects config changes', () => {
    const a = [node('n', { x: 0, y: 0 }, { duration: 4 })];
    const b = [node('n', { x: 0, y: 0 }, { duration: 8 })];
    expect(dataSnapshotHash(a, [])).not.toBe(dataSnapshotHash(b, []));
  });

  it('reflects edge changes (id, output_id)', () => {
    const nodes = [node('a', { x: 0, y: 0 }), node('b', { x: 1, y: 1 })];
    expect(dataSnapshotHash(nodes, [edge('e1', 'a', 'b')])).not.toBe(
      dataSnapshotHash(nodes, [edge('e1', 'a', 'b', 'true')]),
    );
  });

  it('treats output_id / outputId / label as equivalent on the read side', () => {
    const nodes = [node('a', { x: 0, y: 0 }), node('b', { x: 1, y: 1 })];
    const canon = dataSnapshotHash(nodes, [
      { id: 'e1', source: 'a', target: 'b', output_id: 'default' },
    ]);
    const aliased = dataSnapshotHash(nodes, [
      { id: 'e1', source: 'a', target: 'b', outputId: 'default' },
    ]);
    const legacy = dataSnapshotHash(nodes, [
      { id: 'e1', source: 'a', target: 'b', label: 'default' },
    ]);
    expect(canon).toBe(aliased);
    expect(canon).toBe(legacy);
  });
});

describe('layoutSnapshotHash', () => {
  it('reflects only position changes', () => {
    const a = [node('n', { x: 0, y: 0 })];
    const b = [node('n', { x: 1, y: 0 })];
    expect(layoutSnapshotHash(a)).not.toBe(layoutSnapshotHash(b));
  });

  it('is stable under node array order', () => {
    const a = [node('a', { x: 0, y: 0 }), node('b', { x: 1, y: 1 })];
    const b = [...a].reverse();
    expect(layoutSnapshotHash(a)).toBe(layoutSnapshotHash(b));
  });
});
