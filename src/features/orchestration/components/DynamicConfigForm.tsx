import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import type {
  AttemptPolicy,
  StructuredRequestBody,
} from '@/features/orchestration/types';
import { useWatiTemplates } from '@/features/orchestration/queries/referenceData';
import { cn } from '@/utils';

import {
  InspectorCard,
  InspectorEmptyState,
  InspectorField,
} from './inspector/InspectorPrimitives';
import { ActionTemplatePicker } from './connections/ActionTemplatePicker';
import { BolnaAgentPicker } from './connections/BolnaAgentPicker';
import { ConnectionPicker } from './connections/ConnectionPicker';
import { WatiChannelPicker } from './connections/WatiChannelPicker';
import { WatiTemplatePicker } from './connections/WatiTemplatePicker';
import { AttemptPolicyEditor } from './editors/AttemptPolicyEditor';
import { StructuredRequestBodyEditor } from './editors/StructuredRequestBodyEditor';
import {
  VariableMappingField,
  type VariableMapping,
} from './VariableMappingField';
import {
  reconcileVariableMappingsToParameters,
  variableMappingsEqual,
} from './mappingStateUtils';

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
  /** Backend-emitted hint: per-item validation format (e.g. "e164"). Today
   *  used on WATI ``channel_numbers`` items to render an inline error when
   *  an entry isn't a valid E.164 number. */
  'x-format'?: string;
  'x-provider'?: string;
  'x-providers'?: string[];
  'x-channel'?: string;
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
  /** Phase 14 follow-up — partial-reveal previews for stored secret
   *  values, keyed by JSON-Schema field name. Format `XYZA••••WXYZ` for
   *  values ≥ 8 chars, `••••WXYZ` for shorter values. Surfaces as the
   *  placeholder + a small caption next to the eye-toggle so operators
   *  can confirm by shape ("yes that's the prod key, last 4 = WXYZ")
   *  without the page ever shipping plaintext. UI hint only. */
  secretPreviews?: Record<string, string>;
  /** Connection id used by `variable_mapping_list` fields to introspect
   *  agent variables. Optional — the field falls back to free-text input
   *  when no connection has been selected yet. */
  connectionIdForVariables?: string;
  agentIdForVariables?: string;
  templateNameForVariables?: string;
}

export function DynamicConfigForm({
  schema,
  value,
  onChange,
  hiddenFields,
  appId,
  secretsOptional,
  secretPreviews,
  connectionIdForVariables,
  agentIdForVariables,
  templateNameForVariables,
}: Props) {
  // Phase 14 / C4 — template parameters are derived from the TQ cache
  // keyed by connection id, never from form-local state. Previously a
  // local `selectedWatiTemplate` lingered across node selections and
  // produced "config lost on drag" symptoms whenever the form was reused
  // between nodes whose template names disagreed. The new identity is
  // `(connection_id, template_name) → parameters`, single-sourced.
  const { data: watiTemplates } = useWatiTemplates(connectionIdForVariables);
  const properties = schema?.properties ?? {};
  const variableMappingFieldKey = Object.entries(properties).find(
    ([, prop]) => prop['x-type'] === 'variable_mapping_list',
  )?.[0];
  const required = new Set(schema.required ?? []);
  const matchedWatiTemplate = templateNameForVariables
    ? (watiTemplates?.items.find((t) => t.name === templateNameForVariables) ?? null)
    : null;
  const templateParametersForVariables = matchedWatiTemplate?.parameters;

  useEffect(() => {
    if (!variableMappingFieldKey || !templateParametersForVariables) {
      return;
    }
    const currentMappings = Array.isArray(value[variableMappingFieldKey])
      ? (value[variableMappingFieldKey] as VariableMapping[])
      : [];
    const nextMappings = reconcileVariableMappingsToParameters(
      currentMappings,
      templateParametersForVariables,
    );
    if (variableMappingsEqual(currentMappings, nextMappings)) {
      return;
    }
    onChange({ ...value, [variableMappingFieldKey]: nextMappings });
  }, [
    onChange,
    templateParametersForVariables,
    value,
    variableMappingFieldKey,
  ]);

  if (!schema?.properties) return null;

  const handleField = (key: string, fieldValue: unknown) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <div className="space-y-4">
      {Object.entries(properties).map(([key, prop]) => {
        if (hiddenFields?.has(key)) return null;
        const fieldValue = value[key] ?? prop.default ?? defaultForType(prop);
        const label = prop.title ?? key;
        const isRequired = required.has(key);
        const fieldId = `field-${key}`;
        return (
          <InspectorField
            key={key}
            label={label}
            htmlFor={fieldId}
            required={isRequired}
            description={prop.description}
            className="gap-2"
          >
            <FieldRenderer
              fieldId={fieldId}
              fieldKey={key}
              prop={prop}
              fieldValue={fieldValue}
              label={label}
              onChange={handleField}
              appId={appId}
              secretsOptional={secretsOptional}
              secretPreview={secretPreviews?.[key]}
              connectionIdForVariables={connectionIdForVariables}
              agentIdForVariables={agentIdForVariables}
              templateNameForVariables={templateNameForVariables}
              templateParametersForVariables={templateParametersForVariables}
            />
          </InspectorField>
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
  /** Partial-reveal preview for this field if it's an `x-secret` and a
   *  value is already stored. `undefined` for fields with nothing on
   *  record. */
  secretPreview?: string;
  connectionIdForVariables?: string;
  agentIdForVariables?: string;
  templateNameForVariables?: string;
  templateParametersForVariables?: string[];
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
  secretPreview,
  connectionIdForVariables,
  agentIdForVariables,
  templateNameForVariables,
  templateParametersForVariables,
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
  if (prop['x-type'] === 'bolna_agent_picker') {
    return (
      <BolnaAgentPicker
        connectionId={connectionIdForVariables}
        value={typeof fieldValue === 'string' ? fieldValue : ''}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop['x-type'] === 'action_template_picker') {
    return (
      <ActionTemplatePicker
        appId={appId}
        channel={prop['x-channel'] ?? ''}
        value={typeof fieldValue === 'string' ? fieldValue : ''}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop['x-type'] === 'wati_template_picker') {
    return (
      <WatiTemplatePicker
        connectionId={connectionIdForVariables}
        value={typeof fieldValue === 'string' ? fieldValue : ''}
        onChange={(next) => onChange(fieldKey, next)}
      />
    );
  }
  if (prop['x-type'] === 'wati_channel_picker') {
    return (
      <WatiChannelPicker
        connectionId={connectionIdForVariables}
        value={typeof fieldValue === 'string' ? fieldValue : ''}
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
        templateName={templateNameForVariables}
        templateParameters={templateParametersForVariables}
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
    return (
      <SecretField
        fieldId={fieldId}
        fieldKey={fieldKey}
        fieldValue={fieldValue}
        secretsOptional={secretsOptional}
        secretPreview={secretPreview}
        onChange={onChange}
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
      <InspectorCard className="bg-[var(--bg-primary)]">
        <DynamicConfigForm
          schema={prop as JsonSchema}
          value={(fieldValue as Record<string, unknown>) ?? {}}
          onChange={(next) => onChange(fieldKey, next)}
          appId={appId}
          secretsOptional={secretsOptional}
          connectionIdForVariables={connectionIdForVariables}
          agentIdForVariables={agentIdForVariables}
          templateNameForVariables={templateNameForVariables}
        />
      </InspectorCard>
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

interface SecretFieldProps {
  fieldId: string;
  fieldKey: string;
  fieldValue: unknown;
  secretsOptional?: boolean;
  /** Partial-reveal preview (e.g. `XYZA••••WXYZ`) of the stored value.
   *  Surfaces as the input placeholder + a small caption beneath the
   *  field so the operator can confirm by shape without the page ever
   *  shipping plaintext. `undefined` for create-mode forms or fields
   *  with nothing on record. */
  secretPreview?: string;
  onChange: (key: string, value: unknown) => void;
}

function SecretField({
  fieldId,
  fieldKey,
  fieldValue,
  secretsOptional,
  secretPreview,
  onChange,
}: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const valueStr = typeof fieldValue === 'string' ? fieldValue : '';
  // Placeholder priority: a stored-value preview wins (so the field
  // visibly identifies which key is on record). Otherwise fall back to
  // the edit-mode "leave blank" hint, then the generic dot mask.
  const placeholder = secretPreview
    ? secretPreview
    : secretsOptional
      ? 'Leave blank to keep current value'
      : '••••••••';
  return (
    <div className="relative">
      <Input
        id={fieldId}
        type={revealed ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={placeholder}
        value={valueStr}
        onChange={(e) => {
          const next = e.target.value;
          if (secretsOptional && next === '') {
            onChange(fieldKey, undefined);
            return;
          }
          onChange(fieldKey, next);
        }}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? 'Hide value' : 'Show value'}
        title={revealed ? 'Hide' : 'Show'}
        className={cn(
          'absolute inset-y-0 right-2 flex items-center text-[var(--text-secondary)]',
          'hover:text-[var(--text-primary)] focus:outline-none',
        )}
      >
        {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      {secretPreview && valueStr === '' ? (
        // Caption shown only when the user hasn't typed a replacement yet.
        // Once they start typing, the new value will replace the stored
        // one on save, so this hint becomes stale and we hide it.
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Stored value: <span className="font-mono">{secretPreview}</span>
          {' · '}leave blank to keep, or type a new value to replace.
        </p>
      ) : null}
    </div>
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
    <div className="flex flex-col gap-3 rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      {value.length === 0 ? (
        <InspectorEmptyState>No entries — click Add to insert one.</InspectorEmptyState>
      ) : null}
      {value.map((entry, idx) => (
        <InspectorCard key={idx}>
          <div className="flex items-start gap-3">
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
        </InspectorCard>
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

const E164_REGEX = /^\+\d{8,15}$/;

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
  const stringValue = String(value ?? '');
  const formatHint = prop['x-format'];
  const isInvalidE164 =
    formatHint === 'e164' && stringValue !== '' && !E164_REGEX.test(stringValue);
  return (
    <div className="flex flex-col gap-1">
      <Input
        type="text"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={formatHint === 'e164' ? '+911234567890' : undefined}
      />
      {isInvalidE164 && (
        <p className="text-xs text-[var(--color-error)]">
          Must be E.164 — start with “+” followed by 8–15 digits.
        </p>
      )}
    </div>
  );
}
