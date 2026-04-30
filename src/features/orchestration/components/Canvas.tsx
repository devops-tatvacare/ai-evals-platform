import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useMemo, type DragEvent } from 'react';
import '@xyflow/react/dist/style.css';

import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type { NodeTypeDescriptor } from '@/features/orchestration/types';
import { CustomNode } from './CustomNode';

const nodeTypes = { custom: CustomNode };

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const edges = useWorkflowBuilderStore((s) => s.edges);
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const desc = palette.find((p) => p.nodeType === n.type);
        return {
          id: n.id,
          type: 'custom',
          position: n.position,
          data: {
            label: desc?.label ?? n.type,
            nodeType: n.type,
            category: desc?.category ?? 'logic',
            outputEdges: desc?.outputEdges ?? ['default'],
          },
        };
      }),
    [nodes, palette],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.label,
        label: e.label,
      })),
    [edges],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const s = useWorkflowBuilderStore.getState();
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        s.updateNodePosition(c.id, c.position);
      } else if (c.type === 'remove') {
        s.removeNode(c.id);
      } else if (c.type === 'select') {
        s.setSelectedNode(c.selected ? c.id : null);
      }
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const s = useWorkflowBuilderStore.getState();
    for (const c of changes) {
      if (c.type === 'remove') s.removeEdge(c.id);
    }
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    const s = useWorkflowBuilderStore.getState();
    if (!conn.source || !conn.target) return;
    s.addEdge({
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: conn.source,
      target: conn.target,
      label: conn.sourceHandle ?? 'default',
    });
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dataStr = event.dataTransfer.getData('application/orchestration-node');
    if (!dataStr) return;
    let desc: NodeTypeDescriptor;
    try {
      desc = JSON.parse(dataStr) as NodeTypeDescriptor;
    } catch {
      return;
    }
    const s = useWorkflowBuilderStore.getState();
    const bounds = event.currentTarget.getBoundingClientRect();
    s.addNode({
      id: `${desc.nodeType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: desc.nodeType,
      position: {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      },
      data: { label: desc.label, nodeType: desc.nodeType },
      config: {},
    });
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
