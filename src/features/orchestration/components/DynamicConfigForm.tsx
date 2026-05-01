import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import type {
  AttemptPolicy,
  StructuredRequestBody,
} from '@/features/orchestration/types';
import { cn } from '@/utils';

import { ConnectionPicker } from './connections/ConnectionPicker';
import { AttemptPolicyEditor } from './editors/AttemptPolicyEditor';
import { StructuredRequestBodyEditor } from './editors/StructuredRequestBodyEditor';
import {
  VariableMappingField,
  type VariableMapping,
} from './VariableMappingField';

interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  /** Backend-emitted hint: render as a password input. On edit forms (when
   *  `secretsOptional` is true) blanks are interpreted as "leave the stored
   *  value unchanged" and never submitted. */
  'x-secret'?: boolean;
  /** Backend-emitted hint: swap the default renderer for a specialised
   *  field. Currently `connection_picker` and `variable_mapping_list`. */
  'x-type'?: string;
  'x-provider'?: string;
  'x-providers'?: string[];
}

export interface JsonSchema extends JsonSchemaProperty {
  properties: Record<string, JsonSchemaProperty>;
}

interface Props {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange(next: Record<string, unknown>): void;
  /** Field names hidden from rendering even if declared in the schema. Used to
   *  hide source-node fields like ``next_node_id`` whose values come from the
   *  visual graph at save-time, not from manual entry. */
  hiddenFields?: ReadonlySet<string>;
  /** Required by `connection_picker` fields so they can list connections
   *  scoped to the current app. Surfaces from the page's app context. */
  appId?: string;
  /** When true, blank `x-secret` inputs render with a "leave blank to keep
   *  current value" placeholder and are not submitted on change. Used by
   *  ConnectionForm in edit mode. */
  secretsOptional?: boolean;
  /** Connection id used by `variable_mapping_list` fields to introspect
   *  agent variables. Optional — the field falls back to free-text input
   *  when no connection has been selected yet. */
  connectionIdForVariables?: string;
  agentIdForVariables?: string;
  templateSlugForVariables?: string;
}

export function DynamicConfigForm({
  schema,
  value,
  onChange,
  hiddenFields,
  appId,
  secretsOptional,
  connectionIdForVariables,
  agentIdForVariables,
  templateSlugForVariables,
}: Props) {
  if (!schema?.properties) return null;
  const required = new Set(schema.required ?? []);

  const handleField = (key: string, fieldValue: unknown) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <div className="space-y-4">
      {Object.entries(schema.properties).map(([key, prop]) => {
        if (hiddenFields?.has(key)) return null;
        const fieldValue = value[key] ?? prop.default ?? defaultForType(prop);
        const label = prop.title ?? key;
        const isRequired = required.has(key);
        const fieldId = `field-${key}`;
        return (
          <div key={key} className="flex flex-col gap-1">
            <label
              htmlFor={fieldId}
              className={cn('text-sm font-medium text-[var(--text-primary)]')}
            >
              {label}
              {isRequired && <span className="ml-1 text-[var(--color-error)]">*</span>}
            </label>
            {prop.description && (
              <p className="text-xs text-[var(--text-secondary)]">{prop.description}</p>
            )}
            <FieldRenderer
              fieldId={fieldId}
              fieldKey={key}
              prop={prop}
              fieldValue={fieldValue}
              label={label}
              onChange={handleField}
               appId={appId}
               secretsOptional={secretsOptional}
               connectionIdForVariables={connectionIdForVariables}
               agentIdForVariables={agentIdForVariables}
               templateSlugForVariables={templateSlugForVariables}
             />
          </div>
        );
      })}
    </div>
  );
}

function defaultForType(prop: JsonSchemaProperty): unknown {
  if (prop.type === 'array') return [];
  if (prop.type === 'object') return {};
  if (prop.type === 'boolean') return false;
  return '';
}

interface FieldRendererProps {
  fieldId: string;
  fieldKey: string;
  prop: JsonSchemaProperty;
  fieldValue: unknown;
  label: string;
  onChange: (key: string, value: unknown) => void;
  appId?: string;
  secretsOptional?: boolean;
  connectionIdForVariables?: string;
  agentIdForVariables?: string;
  templateSlugForVariables?: string;
}

function FieldRenderer({
  fieldId,
  fieldKey,
  prop,
  fieldValue,
  label,
  onChange,
  appId,
  secretsOptional,
  connectionIdForVariables,
  agentIdForVariables,
  templateSlugForVariables,
}: FieldRendererProps) {
  // Specialised x-type renderers run before the generic type/enum
  // dispatch so they can override the default password / array behavior.
  if (prop['x-type'] === 'connection_picker') {
    if (!appId) {
      return (
        <p className="text-xs text-[var(--color-error)]">
          Connection picker requires an app context.
        </p>
      );
    }
    const providers = prop['x-providers'];
    const provider = prop['x-provider'];
    const valueStr = typeof fieldValue === 'string' ? fieldValue : '';
    if (providers && providers.length > 0) {
      return (
        <ConnectionPicker
          appId={appId}
          providers={providers}
          value={valueStr}
          onChange={(next) => onChange(fieldKey, next)}
        />
      );
    }
    return (
      <ConnectionPicker
        appId={appId}
        provider={provider ?? ''}
        value={valueStr}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop['x-type'] === 'variable_mapping_list') {
    return (
        <VariableMappingField
          value={Array.isArray(fieldValue) ? (fieldValue as VariableMapping[]) : []}
          onChange={(next) => onChange(fieldKey, next)}
          connectionId={connectionIdForVariables}
          agentId={agentIdForVariables}
          templateSlug={templateSlugForVariables}
        />
      );
  }
  if (prop['x-type'] === 'structured_request_body') {
    return (
      <StructuredRequestBodyEditor
        value={fieldValue as StructuredRequestBody | undefined}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop['x-type'] === 'attempt_policy') {
    return (
      <AttemptPolicyEditor
        value={fieldValue as AttemptPolicy | undefined}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop['x-secret']) {
    // For edit forms (`secretsOptional`), an empty submission means "leave
    // the stored value unchanged" — we never push the empty string back to
    // the parent, which would otherwise overwrite the stored credential.
    return (
      <Input
        id={fieldId}
        type="password"
        autoComplete="new-password"
        placeholder={
          secretsOptional ? 'Leave blank to keep current value' : '••••••••'
        }
        value={typeof fieldValue === 'string' ? fieldValue : ''}
        onChange={(e) => {
          const next = e.target.value;
          if (secretsOptional && next === '') {
            // Surface as undefined so the parent strips this key from the
            // PATCH body. The form submitter is responsible for honouring
            // the convention.
            onChange(fieldKey, undefined);
            return;
          }
          onChange(fieldKey, next);
        }}
      />
    );
  }
  if (prop.enum) {
    return (
      <Select
        value={String(fieldValue ?? '')}
        onChange={(next) => onChange(fieldKey, next)}
        placeholder={`Select ${label}`}
        options={prop.enum.map((opt) => ({ value: opt, label: opt }))}
      />
    );
  }
  if (prop.type === 'boolean') {
    return (
      <div>
        <Switch
          id={fieldId}
          checked={Boolean(fieldValue)}
          onCheckedChange={(checked) => onChange(fieldKey, checked)}
        />
      </div>
    );
  }
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <Input
        id={fieldId}
        type="number"
        value={fieldValue === null || fieldValue === undefined ? '' : String(fieldValue)}
        onChange={(e) =>
          onChange(fieldKey, e.target.value === '' ? null : Number(e.target.value))
        }
      />
    );
  }
  if (prop.type === 'array' && prop.items) {
    return (
      <ArrayField
        items={prop.items}
        value={Array.isArray(fieldValue) ? fieldValue : []}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop.type === 'object' && prop.properties) {
    return (
      <div className="rounded-[var(--radius-default)] border border-[var(--border-default)] p-3">
        <DynamicConfigForm
          schema={prop as JsonSchema}
          value={(fieldValue as Record<string, unknown>) ?? {}}
          onChange={(next) => onChange(fieldKey, next)}
          appId={appId}
          secretsOptional={secretsOptional}
          connectionIdForVariables={connectionIdForVariables}
          agentIdForVariables={agentIdForVariables}
          templateSlugForVariables={templateSlugForVariables}
        />
      </div>
    );
  }
  return (
    <Input
      id={fieldId}
      type="text"
      value={String(fieldValue ?? '')}
      onChange={(e) => onChange(fieldKey, e.target.value)}
    />
  );
}

interface ArrayFieldProps {
  items: JsonSchemaProperty;
  value: unknown[];
  onChange(next: unknown[]): void;
}

/** Render a JSON-Schema ``array`` field.
 *
 *  - ``items.type === 'object'`` (with ``properties``) → repeated row of
 *    sub-form, with Remove per row and Add at the bottom. Used by
 *    ``logic.split.branches``, ``source.cohort_query.filters``, and
 *    ``crm.lsq_log_activity.fields``.
 *  - primitive items (``string`` / ``number`` / ``integer``) → repeated
 *    single-input rows. Used by ``source.cohort_query.payload_columns``.
 *
 *  Pre-fix the form fell back to raw JSON editing for both shapes which
 *  pushed users into editing JSON blobs — a phase-6 acceptance gap. */
function ArrayField({ items, value, onChange }: ArrayFieldProps) {
  const addItem = () => {
    onChange([...value, defaultForType(items)]);
  };
  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };
  const updateAt = (idx: number, next: unknown) => {
    onChange(value.map((v, i) => (i === idx ? next : v)));
  };

  const isObjectItem = items.type === 'object' && Boolean(items.properties);
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-default)] border border-[var(--border-default)] p-2">
      {value.length === 0 && (
        <p className="px-1 text-xs text-[var(--text-secondary)]">
          No entries — click Add to insert one.
        </p>
      )}
      {value.map((entry, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2"
        >
          <div className="flex-1">
            {isObjectItem ? (
              <DynamicConfigForm
                schema={items as JsonSchema}
                value={(entry as Record<string, unknown>) ?? {}}
                onChange={(next) => updateAt(idx, next)}
              />
            ) : (
              <PrimitiveItem prop={items} value={entry} onChange={(v) => updateAt(idx, v)} />
            )}
          </div>
          <Button
            variant="danger-outline"
            size="sm"
            onClick={() => removeAt(idx)}
            aria-label={`Remove item ${idx + 1}`}
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" onClick={addItem}>
          Add
        </Button>
      </div>
    </div>
  );
}

interface PrimitiveItemProps {
  prop: JsonSchemaProperty;
  value: unknown;
  onChange(next: unknown): void;
}

function PrimitiveItem({ prop, value, onChange }: PrimitiveItemProps) {
  if (prop.enum) {
    return (
      <Select
        value={String(value ?? '')}
        onChange={(next) => onChange(next)}
        options={prop.enum.map((opt) => ({ value: opt, label: opt }))}
      />
    );
  }
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <Input
        type="number"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }
  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
