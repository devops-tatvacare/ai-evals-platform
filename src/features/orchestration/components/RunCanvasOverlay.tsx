import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useMemo } from 'react';
import '@xyflow/react/dist/style.css';

import type {
  NodeTypeDescriptor,
  WorkflowVersion,
} from '@/features/orchestration/types';
import { useRunOverlayStore } from '@/features/orchestration/store/runOverlayStore';
import { CustomNode, type CustomNodeData } from './CustomNode';

const nodeTypes = { custom: CustomNode };

/** Read-only run view of the workflow canvas. Same node primitive as the
 *  builder; `data.overlay` carries the live status pill + cohort badge. */
interface RunCanvasOverlayProps {
  version: WorkflowVersion;
  /** Optional registry — used only to colour the node category. Falls back to
   *  the value already stored on the node definition (or 'logic'). */
  nodeTypesRegistry?: NodeTypeDescriptor[];
}

export function RunCanvasOverlay({
  version,
  nodeTypesRegistry,
}: RunCanvasOverlayProps) {
  return (
    <ReactFlowProvider>
      <RunCanvasOverlayInner version={version} nodeTypesRegistry={nodeTypesRegistry} />
    </ReactFlowProvider>
  );
}

function RunCanvasOverlayInner({
  version,
  nodeTypesRegistry,
}: RunCanvasOverlayProps) {
  const overlay = useRunOverlayStore((s) => s.byNodeId);

  const categoryByType = useMemo(() => {
    const map = new Map<string, string>();
    (nodeTypesRegistry ?? []).forEach((d) => map.set(d.nodeType, d.category));
    return map;
  }, [nodeTypesRegistry]);

  const onInit = useCallback((rf: ReactFlowInstance<Node<CustomNodeData>, Edge>) => {
    const saved = version.definition.canvas?.viewport;
    if (saved) {
      rf.setViewport(saved);
      return;
    }
    rf.fitView({ padding: 0.2 });
  }, [version.definition.canvas?.viewport]);

  const rfNodes: Node<CustomNodeData>[] = useMemo(
    () =>
      version.definition.nodes.map((n) => {
        const ov = overlay[n.id];
        const data: CustomNodeData = {
          label: n.data?.label ?? n.type,
          nodeType: n.type,
          category: categoryByType.get(n.type) ?? 'logic',
          outputEdges: ['default'],
          overlay: ov
            ? { status: ov.status, cohortSize: ov.inputCohortSize }
            : undefined,
        };
        return {
          id: n.id,
          type: 'custom',
          position: n.position,
          data,
          draggable: false,
          selectable: false,
        };
      }),
    [version, overlay, categoryByType],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      version.definition.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
      })),
    [version],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onInit={onInit}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
