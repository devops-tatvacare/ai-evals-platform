import { useMemo } from 'react';
import { X } from 'lucide-react';

import { useCurrentAppId } from '@/hooks';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type {
  MergePolicy,
  PayloadPolicy,
  PredicateAst,
  SplitBranch,
  SplitMode,
  WorkflowType,
} from '@/features/orchestration/types';

import { DynamicConfigForm, type JsonSchema } from './DynamicConfigForm';
import { InspectorSection } from './inspector/InspectorPrimitives';
import { DatasetPicker } from './editors/DatasetPicker';
import { MergePolicyEditor } from './editors/MergePolicyEditor';
import { PredicateBuilder } from './editors/PredicateBuilder';
import { SavedCohortPicker } from './editors/SavedCohortPicker';
import { SplitBranchEditor } from './editors/SplitBranchEditor';
import { WaitConditionEditor } from './editors/WaitConditionEditor';

export function NodeConfigPanel() {
  const appId = useCurrentAppId();
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const node = useWorkflowBuilderStore((s) =>
    s.nodes.find((n) => n.id === selectedNodeId) ?? null,
  );
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);
  const workflowType = useWorkflowBuilderStore((s) => s.workflowType);
  const updateConfig = useWorkflowBuilderStore((s) => s.updateNodeConfig);
  const clearSelection = useWorkflowBuilderStore((s) => s.clearSelection);
  // Phase-14 follow-up — view mode renders the same inspector body
  // wrapped in a disabled fieldset. Browser-native disabling propagates
  // to every form input and button inside, so we don't have to thread a
  // `readOnly` prop through every specialised editor.
  const viewMode = useWorkflowBuilderStore((s) => s.viewMode);
  const setViewMode = useWorkflowBuilderStore((s) => s.setViewMode);
  const readOnly = viewMode === 'view';

  // Descriptor lookup must come before any conditional rendering so the
  // hooks below see a stable input identity regardless of node selection.
  const desc = useMemo(
    () => palette.find((p) => p.nodeType === node?.type) ?? null,
    [palette, node?.type],
  );

  const editorHints = desc?.editorHints;
  const hiddenFields = useMemo<ReadonlySet<string> | undefined>(() => {
    const declared = (editorHints?.hiddenFields as string[] | undefined) ?? [];
    if (declared.length === 0) return undefined;
    return new Set(declared);
  }, [editorHints]);

  const closeButton = (
    <button
      type="button"
      onClick={clearSelection}
      aria-label="Close inspector"
      className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );

  if (!node) {
    return (
      <div className="flex h-full w-80 items-center justify-center border-l border-[var(--border-subtle)] p-4 text-sm text-[var(--text-secondary)]">
        Select a node to edit its config.
      </div>
    );
  }
  if (!desc) {
    return (
      <div className="flex h-full w-80 flex-col border-l border-[var(--border-subtle)] p-4 text-sm text-[var(--text-secondary)]">
        <div className="mb-2 flex items-start justify-between gap-2">
          <span>Unknown node type: {node.type}</span>
          {closeButton}
        </div>
      </div>
    );
  }

  // Descriptor-driven editor dispatch. A specialised editor is chosen via
  // `descriptor.editorHints.preferredEditor`; nodes without a hint render
  // through `DynamicConfigForm`.
  const preferredEditor = desc.editorHints?.preferredEditor as
    | string
    | undefined;

  const _wfType = (workflowType ?? 'crm') as WorkflowType;
  void _wfType;
  const config = node.config as Record<string, unknown>;

  // Common helper used by every specialised editor: shallow-merge a config
  // patch and persist via the store. Specialised editors hand back a full
  // canonical sub-object for their slice so we don't have to thread a
  // separate `patch` shape.
  const setConfig = (next: Record<string, unknown>) => updateConfig(node.id, next);

  let body: React.ReactNode;

  switch (preferredEditor) {
    case 'SavedCohortPicker': {
      body = (
        <SavedCohortPicker
          value={config}
          onChange={(next) => setConfig({ ...config, ...next })}
        />
      );
      break;
    }
    case 'DatasetPicker': {
      body = (
        <DatasetPicker
          value={config}
          onChange={(next) => setConfig({ ...config, ...next })}
        />
      );
      break;
    }
    case 'PredicateBuilder': {
      const predicate = config.predicate as PredicateAst | undefined;
      const eventMatch = config.event_match as PredicateAst | undefined;
      // `logic.wait` uses the WaitConditionEditor (which embeds a predicate
      // builder for event_match). `filter.eligibility` and
      // `logic.conditional` use the predicate builder directly.
      const isWait = node.type === 'logic.wait';
      body = isWait ? (
        <WaitConditionEditor
          value={config as Parameters<typeof WaitConditionEditor>[0]['value']}
          onChange={(next) => setConfig({ ...config, ...next })}
        />
      ) : (
        <PredicateBuilder
          value={predicate ?? eventMatch}
          onChange={(next) =>
            setConfig({ ...config, predicate: next })
          }
        />
      );
      break;
    }
    case 'SplitBranchEditor': {
      // Field suggestions are not yet plumbed through the builder store
      // (the upstream source's allowed columns aren't available here yet);
      // SplitBranchEditor falls back to a free-text field input.
      body = (
        <SplitBranchEditor
          value={config as {
            mode?: SplitMode;
            field?: string;
            branches?: SplitBranch[];
            default_branch_id?: string;
            drop_unmatched?: boolean;
          }}
          onChange={(next) => setConfig({ ...config, ...next })}
        />
      );
      break;
    }
    case 'WaitConditionEditor': {
      body = (
        <WaitConditionEditor
          value={config as Parameters<typeof WaitConditionEditor>[0]['value']}
          onChange={(next) => setConfig({ ...config, ...next })}
        />
      );
      break;
    }
    case 'MergePolicyEditor': {
      body = (
        <MergePolicyEditor
          value={
            config as { merge_policy?: MergePolicy; payload_policy?: PayloadPolicy }
          }
          onChange={(next) => setConfig({ ...config, ...next })}
        />
      );
      break;
    }
    case 'StructuredRequestBodyEditor': {
      // The webhook editor still needs URL / method / headers / timeout
      // / attempt_policy — render the generic schema form for those, but
      // override the `body` field with the structured editor.
      body = (
        <DynamicConfigForm
          schema={desc.configSchema as unknown as JsonSchema}
          value={config}
          onChange={setConfig}
          hiddenFields={hiddenFields}
          appId={appId}
          connectionIdForVariables={
            typeof config.connection_id === 'string' ? config.connection_id : undefined
          }
          agentIdForVariables={
            typeof config.agent_id === 'string' && config.agent_id
              ? config.agent_id
              : undefined
          }
          templateNameForVariables={
            typeof config.template_name === 'string' ? config.template_name : undefined
          }
        />
      );
      break;
    }
    default: {
      body = (
        <DynamicConfigForm
          schema={desc.configSchema as unknown as JsonSchema}
          value={config}
          onChange={setConfig}
          hiddenFields={hiddenFields}
          appId={appId}
          connectionIdForVariables={
            typeof config.connection_id === 'string' ? config.connection_id : undefined
          }
          agentIdForVariables={
            typeof config.agent_id === 'string' && config.agent_id
              ? config.agent_id
              : undefined
          }
          templateNameForVariables={
            typeof config.template_name === 'string' ? config.template_name : undefined
          }
        />
      );
    }
  }

  // Note on attempt policy: dispatch-node descriptors expose
  // ``attempt_policy`` as a config-schema field with
  // ``x-type: attempt_policy``, so DynamicConfigForm renders the
  // AttemptPolicyEditor inline through the FieldRenderer. We don't emit a
  // separate panel-level editor — that would render the same control twice
  // for any dispatch node whose preferredEditor falls through to the
  // default schema form.

  const emptyState = desc.editorHints?.emptyStateMessage as string | undefined;

  return (
    <div className="flex h-full w-80 flex-col gap-3 overflow-y-auto border-l border-[var(--border-subtle)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-[var(--text-primary)]">
            {desc.displayLabel ?? desc.label}
          </div>
          <div className="truncate text-xs text-[var(--text-secondary)]">
            {desc.nodeType}
          </div>
        </div>
        {closeButton}
      </div>
      {readOnly ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2 text-xs text-[var(--text-secondary)]">
          <span>Read-only — switch to Edit to change this node.</span>
          <button
            type="button"
            onClick={() => setViewMode('edit')}
            className="text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            Switch to Edit
          </button>
        </div>
      ) : null}
      {desc.authoringStatus === 'hidden' ? (
        <p className="rounded-[var(--radius-default)] bg-[var(--bg-warning-soft)] p-2 text-xs text-[var(--text-warning)]">
          This node is hidden from the palette. Existing definitions still
          execute, but new authoring is disabled.
        </p>
      ) : null}
      {emptyState ? (
        <p className="rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2 text-xs text-[var(--text-secondary)]">
          {emptyState}
        </p>
      ) : null}
      {/* Browser-native fieldset disable: every form input + button inside
       *  becomes non-interactive when `disabled` is set. Cheaper than
       *  threading a `readOnly` prop through every specialised editor. */}
      <fieldset disabled={readOnly} className="contents">
        {body}
        {desc.requiredPayloadFields && desc.requiredPayloadFields.length > 0 ? (
          <FieldHint
            label="Requires payload fields"
            fields={desc.requiredPayloadFields}
          />
        ) : null}
        {desc.emittedPayloadFields && desc.emittedPayloadFields.length > 0 ? (
          <FieldHint
            label="Emits payload fields"
            fields={desc.emittedPayloadFields}
          />
        ) : null}
      </fieldset>
    </div>
  );
}

function FieldHint({ label, fields }: { label: string; fields: string[] }) {
  return (
    <InspectorSection title={label}>
      <div className="flex flex-wrap gap-1">
        {fields.map((f) => (
          <code
            key={f}
            className="rounded-[var(--radius-default)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]"
          >
            {f}
          </code>
        ))}
      </div>
    </InspectorSection>
  );
}
