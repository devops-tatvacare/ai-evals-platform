import { Plus, Settings, Trash2 } from 'lucide-react';
import { Button, EmptyState, Input, RoleBadge, Select, StarToggle } from '@/components/ui';
import { ArrayItemConfigModal } from './ArrayItemConfigModal';
import { useState } from 'react';
import type {
  ArrayItemSchema,
  EvaluatorFieldType,
  EvaluatorOutputField,
  FieldRole,
} from '@/types';

interface SchemaTableProps {
  fields: EvaluatorOutputField[];
  onChange?: (fields: EvaluatorOutputField[]) => void;
  readOnly?: boolean;
}

const ROLE_OPTIONS: FieldRole[] = ['metric', 'detail', 'reasoning'];
const TYPE_OPTIONS: EvaluatorFieldType[] = ['number', 'text', 'boolean', 'array', 'enum'];

function deriveDisplayMode(field: EvaluatorOutputField): EvaluatorOutputField['displayMode'] {
  if (field.isMainMetric) {
    return 'header';
  }
  if (field.role === 'reasoning') {
    return 'hidden';
  }
  return 'card';
}

function normalizeField(field: EvaluatorOutputField): EvaluatorOutputField {
  const role = field.role ?? (field.isMainMetric ? 'metric' : 'detail');
  return {
    ...field,
    role,
    displayMode: deriveDisplayMode({ ...field, role }),
  };
}

function createDefaultField(): EvaluatorOutputField {
  return normalizeField({
    key: '',
    type: 'text',
    description: '',
    displayMode: 'card',
    role: 'detail',
    isMainMetric: false,
  });
}

export function SchemaTable({ fields, onChange, readOnly = false }: SchemaTableProps) {
  const [arrayConfig, setArrayConfig] = useState<{
    isOpen: boolean;
    fieldIndex: number | null;
  }>({ isOpen: false, fieldIndex: null });

  const updateField = (index: number, updates: Partial<EvaluatorOutputField>) => {
    if (!onChange) {
      return;
    }
    const nextFields = fields.map((field, fieldIndex) => {
      if (fieldIndex !== index) {
        if (updates.isMainMetric && fieldIndex !== index) {
          return { ...field, isMainMetric: false, displayMode: deriveDisplayMode({ ...field, isMainMetric: false }) };
        }
        return field;
      }

      const nextType = updates.type ?? field.type;
      const nextIsMainMetric = nextType === 'number'
        ? Boolean(updates.isMainMetric ?? field.isMainMetric)
        : false;
      const nextRole = nextIsMainMetric
        ? 'metric'
        : updates.role === 'reasoning'
          ? 'reasoning'
          : updates.role ?? field.role ?? 'detail';

      return normalizeField({
        ...field,
        ...updates,
        type: nextType,
        isMainMetric: nextIsMainMetric,
        role: nextRole,
      });
    });

    onChange(nextFields);
  };

  const addField = () => {
    onChange?.([...fields, createDefaultField()]);
  };

  const removeField = (index: number) => {
    onChange?.(fields.filter((_, fieldIndex) => fieldIndex !== index));
  };

  const saveArraySchema = (schema: ArrayItemSchema | null) => {
    if (arrayConfig.fieldIndex === null) {
      return;
    }
    updateField(arrayConfig.fieldIndex, { arrayItemSchema: schema ?? undefined });
    setArrayConfig({ isOpen: false, fieldIndex: null });
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Output Schema</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Define the evaluator result fields using role-based output semantics.
            </p>
          </div>
          {!readOnly ? (
            <Button variant="secondary" size="sm" onClick={addField} icon={Plus}>
              Add Field
            </Button>
          ) : null}
        </div>

        {fields.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="No output fields yet"
            description="Add fields manually or generate a draft from the prompt."
            compact
            action={readOnly ? undefined : { label: 'Add Field', onClick: addField }}
          />
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-[var(--border-default)]">
            <table className="w-full min-w-[860px] border-collapse">
              <thead className="bg-[var(--bg-secondary)]">
                <tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2 font-medium">Main</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Thresholds</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const normalized = normalizeField(field);
                  return (
                    <tr
                      key={`${normalized.key || 'field'}-${index}`}
                      className="border-b border-[var(--border-subtle)] align-top last:border-b-0"
                    >
                      <td className="px-3 py-3">
                        <StarToggle
                          checked={Boolean(normalized.isMainMetric)}
                          onChange={(checked) => updateField(index, { isMainMetric: checked, role: 'metric' })}
                          disabled={readOnly || normalized.type !== 'number'}
                          title={normalized.type === 'number' ? 'Mark as main metric' : 'Only number fields can be main metrics'}
                        />
                      </td>
                      <td className="px-3 py-3">
                        {readOnly ? (
                          <code className="text-[12px] text-[var(--text-primary)]">{normalized.key}</code>
                        ) : (
                          <Input
                            value={normalized.key}
                            onChange={(e) => updateField(index, { key: e.target.value })}
                            placeholder="overall_score"
                            className="h-8 text-xs"
                          />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {readOnly ? (
                          <span className="text-sm text-[var(--text-primary)]">{normalized.type}</span>
                        ) : (
                          <Select
                            value={normalized.type}
                            onChange={(val) => updateField(index, { type: val as EvaluatorFieldType })}
                            options={TYPE_OPTIONS.map((option) => ({ value: option, label: option }))}
                            size="sm"
                          />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {readOnly ? (
                          <RoleBadge role={normalized.role ?? 'detail'} />
                        ) : (
                          <Select
                            value={normalized.role ?? 'detail'}
                            onChange={(val) => updateField(index, { role: val as FieldRole })}
                            options={ROLE_OPTIONS.map((option) => ({ value: option, label: option }))}
                            size="sm"
                          />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {readOnly ? (
                          <p className="max-w-[320px] text-sm text-[var(--text-primary)]">{normalized.description}</p>
                        ) : (
                          <Input
                            value={normalized.description}
                            onChange={(e) => updateField(index, { description: e.target.value })}
                            placeholder="What this field means"
                            className="h-8 text-xs"
                          />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {normalized.type === 'number' ? (
                          readOnly ? (
                            <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                              <div>Green: {normalized.thresholds?.green ?? 'n/a'}</div>
                              <div>Yellow: {normalized.thresholds?.yellow ?? 'n/a'}</div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                value={normalized.thresholds?.green ?? ''}
                                onChange={(e) => updateField(index, {
                                  thresholds: {
                                    green: Number(e.target.value || 0),
                                    yellow: normalized.thresholds?.yellow ?? 0,
                                  },
                                })}
                                placeholder="Green"
                                className="h-8 text-xs"
                              />
                              <Input
                                type="number"
                                value={normalized.thresholds?.yellow ?? ''}
                                onChange={(e) => updateField(index, {
                                  thresholds: {
                                    green: normalized.thresholds?.green ?? 0,
                                    yellow: Number(e.target.value || 0),
                                  },
                                })}
                                placeholder="Yellow"
                                className="h-8 text-xs"
                              />
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">n/a</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {normalized.type === 'array' && !readOnly ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setArrayConfig({ isOpen: true, fieldIndex: index })}
                              icon={Settings}
                            >
                              Items
                            </Button>
                          ) : null}
                          {!readOnly ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeField(index)}
                              icon={Trash2}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ArrayItemConfigModal
        isOpen={arrayConfig.isOpen}
        onClose={() => setArrayConfig({ isOpen: false, fieldIndex: null })}
        onSave={saveArraySchema}
        initialSchema={fields[arrayConfig.fieldIndex ?? -1]?.arrayItemSchema}
        fieldName={fields[arrayConfig.fieldIndex ?? -1]?.key || 'Array field'}
      />
    </>
  );
}
