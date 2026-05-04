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
import { FieldMappingEditor, type FieldMapping } from './editors/FieldMappingEditor';
import { MergePolicyEditor } from './editors/MergePolicyEditor';
import { PredicateBuilder } from './editors/PredicateBuilder';
import { SourceSelector } from './editors/SourceSelector';
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

  const wfType = (workflowType ?? 'crm') as WorkflowType;
  const config = node.config as Record<string, unknown>;

  // Common helper used by every specialised editor: shallow-merge a config
  // patch and persist via the store. Specialised editors hand back a full
  // canonical sub-object for their slice so we don't have to thread a
  // separate `patch` shape.
  const setConfig = (next: Record<string, unknown>) => updateConfig(node.id, next);

  let body: React.ReactNode;

  switch (preferredEditor) {
    case 'SourceSelector': {
      body = (
        <>
          <SourceSelector
            workflowType={wfType}
            appId={appId}
            value={config}
            onChange={(next) => setConfig({ ...config, ...next })}
          />
          <p className="rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2 text-xs text-[var(--text-secondary)]">
            Successor comes from the visual graph — connect this node to its
            next node on the canvas.
          </p>
        </>
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
          templateSlugForVariables={
            typeof config.template_slug === 'string' ? config.template_slug : undefined
          }
        />
      );
      break;
    }
    case 'FieldMappingEditor': {
      // Mutation nodes — the descriptor schema still drives most fields
      // (connection_id, target_stage, etc.). The `fields` / `field_mappings`
      // / `structured_fields` slot is special-cased.
      body = (
        <>
          <DynamicConfigForm
            schema={desc.configSchema as unknown as JsonSchema}
            value={config}
            onChange={setConfig}
            hiddenFields={mergeHiddenFields(hiddenFields, [
              'fields',
              'field_mappings',
              'structured_fields',
            ])}
            appId={appId}
            connectionIdForVariables={
              typeof config.connection_id === 'string' ? config.connection_id : undefined
            }
            agentIdForVariables={
              typeof config.agent_id === 'string' && config.agent_id
                ? config.agent_id
                : undefined
            }
            templateSlugForVariables={
              typeof config.template_slug === 'string' ? config.template_slug : undefined
            }
          />
          <FieldMappingSlotsForNode
            nodeType={node.type}
            config={config}
            setConfig={setConfig}
          />
        </>
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
          templateSlugForVariables={
            typeof config.template_slug === 'string' ? config.template_slug : undefined
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
    </div>
  );
}

function mergeHiddenFields(
  base: ReadonlySet<string> | undefined,
  extra: string[],
): ReadonlySet<string> {
  const out = new Set<string>(base ?? []);
  for (const f of extra) out.add(f);
  return out;
}

function FieldMappingSlotsForNode({
  nodeType,
  config,
  setConfig,
}: {
  nodeType: string;
  config: Record<string, unknown>;
  setConfig(next: Record<string, unknown>): void;
}) {
  // crm.lsq_log_activity uses `fields` (legacy plural-noun preserved by
  // the existing handler config). clinical.emr_write uses
  // `structured_fields`. crm.lsq_update_stage has no field mappings.
  if (nodeType === 'crm.lsq_log_activity') {
    return (
      <SlotLabel label="Activity field mappings">
        <FieldMappingEditor
          value={config.fields as FieldMapping[] | undefined}
          onChange={(next) => setConfig({ ...config, fields: next })}
          targetLabel="LSQ field"
        />
      </SlotLabel>
    );
  }
  if (nodeType === 'clinical.emr_write') {
    return (
      <SlotLabel label="EMR structured fields">
        <FieldMappingEditor
          value={config.structured_fields as FieldMapping[] | undefined}
          onChange={(next) => setConfig({ ...config, structured_fields: next })}
          targetLabel="EMR field"
        />
      </SlotLabel>
    );
  }
  return null;
}

function SlotLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-[var(--text-primary)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function FieldHint({ label, fields }: { label: string; fields: string[] }) {
  return (
    <div className="rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2 text-xs">
      <div className="mb-1 font-medium text-[var(--text-secondary)]">{label}</div>
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
    </div>
  );
}
