import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import { DynamicConfigForm, type JsonSchema } from './DynamicConfigForm';

export function NodeConfigPanel() {
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const node = useWorkflowBuilderStore((s) =>
    s.nodes.find((n) => n.id === selectedNodeId) ?? null,
  );
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);
  const updateConfig = useWorkflowBuilderStore((s) => s.updateNodeConfig);

  if (!node) {
    return (
      <div className="flex h-full w-80 items-center justify-center border-l border-[var(--border-default)] p-4 text-sm text-[var(--text-secondary)]">
        Select a node to edit its config.
      </div>
    );
  }
  const desc = palette.find((p) => p.nodeType === node.type);
  if (!desc) {
    return (
      <div className="w-80 border-l border-[var(--border-default)] p-4 text-sm text-[var(--text-secondary)]">
        Unknown node type: {node.type}
      </div>
    );
  }
  return (
    <div className="flex h-full w-80 flex-col gap-3 overflow-y-auto border-l border-[var(--border-default)] p-4">
      <div>
        <div className="font-medium text-[var(--text-primary)]">{desc.label}</div>
        <div className="text-xs text-[var(--text-secondary)]">{desc.nodeType}</div>
      </div>
      <DynamicConfigForm
        schema={desc.configSchema as unknown as JsonSchema}
        value={node.config}
        onChange={(next) => updateConfig(node.id, next)}
      />
    </div>
  );
}
