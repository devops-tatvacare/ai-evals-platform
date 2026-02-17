import { useState, useCallback } from 'react';
import { Plus, Trash2, Settings, ListPlus } from 'lucide-react';
import { Input, Button, EmptyState } from '@/components/ui';
import { ArrayItemConfigModal } from './ArrayItemConfigModal';
import { cn } from '@/utils';
import type { EvaluatorOutputField, EvaluatorFieldType, ArrayItemSchema } from '@/types';

interface InlineSchemaBuilderProps {
  fields: EvaluatorOutputField[];
  onChange: (fields: EvaluatorOutputField[]) => void;
  className?: string;
}

export function InlineSchemaBuilder({ fields, onChange, className }: InlineSchemaBuilderProps) {
  const [arrayConfigModal, setArrayConfigModal] = useState<{ isOpen: boolean; fieldIndex: number | null }>({
    isOpen: false,
    fieldIndex: null,
  });

  const addField = useCallback(() => {
    const newField: EvaluatorOutputField = {
      key: '',
      type: 'text',
      description: '',
      displayMode: 'card',
      isMainMetric: false,
    };
    onChange([...fields, newField]);
  }, [fields, onChange]);

  const updateField = useCallback((index: number, updates: Partial<EvaluatorOutputField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    
    // Ensure only one main metric
    if (updates.displayMode === 'header' && updates.isMainMetric) {
      newFields.forEach((f, i) => {
        if (i !== index) f.isMainMetric = false;
      });
    }
    
    onChange(newFields);
  }, [fields, onChange]);

  const removeField = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  }, [fields, onChange]);

  const openArrayConfig = useCallback((index: number) => {
    setArrayConfigModal({ isOpen: true, fieldIndex: index });
  }, []);

  const handleArrayConfigSave = useCallback((schema: ArrayItemSchema | null) => {
    if (arrayConfigModal.fieldIndex !== null) {
      updateField(arrayConfigModal.fieldIndex, { arrayItemSchema: schema ?? undefined });
    }
    setArrayConfigModal({ isOpen: false, fieldIndex: null });
  }, [arrayConfigModal.fieldIndex, updateField]);

  return (
    <>
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Output Schema</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Define what structured data the LLM should return
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={addField}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Field
          </Button>
        </div>
        
        {fields.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title="No output fields defined yet"
            compact
            action={{ label: 'Add Your First Field', onClick: addField }}
          />
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div
                key={index}
                className={cn(
                  "border rounded-lg p-3 transition-colors",
                  "border-[var(--border-default)]",
                  "bg-[var(--bg-surface)]",
                  field.isMainMetric && "border-[var(--color-brand-accent)] bg-[var(--color-brand-accent)]/5"
                )}
              >
                <div className="grid grid-cols-12 gap-3">
                  {/* Key */}
                  <div className="col-span-3">
                    <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                      Key Name
                    </label>
                    <Input
                      value={field.key}
                      onChange={(e) => updateField(index, { key: e.target.value })}
                      placeholder="score"
                      className="h-8 text-xs"
                    />
                  </div>
                  
                  {/* Type */}
                  <div className="col-span-2">
                    <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                      Type
                    </label>
                    <select
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value as EvaluatorFieldType })}
                      className={cn(
                        "h-8 w-full text-xs border rounded px-2",
                        "bg-[var(--bg-surface)] text-[var(--text-primary)]",
                        "border-[var(--border-default)]"
                      )}
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="array">Array</option>
                    </select>
                  </div>
                  
                  {/* Description */}
                  <div className="col-span-5">
                    <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                      Description
                    </label>
                    <Input
                      value={field.description}
                      onChange={(e) => updateField(index, { description: e.target.value })}
                      placeholder="What this field represents"
                      className="h-8 text-xs"
                    />
                  </div>
                  
                  {/* Display Mode - Hidden for EvaluationOverlay use case */}
                  <div className="col-span-2 flex items-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeField(index)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--color-error)]" />
                    </Button>
                  </div>
                </div>
                
                {/* Array Configuration */}
                {field.type === 'array' && (
                  <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">
                          Array Items
                        </label>
                        {field.arrayItemSchema ? (
                          <p className="text-xs text-[var(--text-primary)]">
                            {field.arrayItemSchema.itemType === 'object' 
                              ? `Object (${field.arrayItemSchema.properties?.length || 0} properties)`
                              : field.arrayItemSchema.itemType.charAt(0).toUpperCase() + field.arrayItemSchema.itemType.slice(1)
                            }
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--text-muted)] italic">
                            Not configured (defaults to string array)
                          </p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openArrayConfig(index)}
                        className="h-7"
                      >
                        <Settings className="h-3.5 w-3.5 mr-1" />
                        Configure
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        <p className="text-xs text-[var(--text-muted)]">
          Fields will be converted to JSON Schema when saved
        </p>
      </div>

      {/* Array Configuration Modal */}
      <ArrayItemConfigModal
        isOpen={arrayConfigModal.isOpen}
        onClose={() => setArrayConfigModal({ isOpen: false, fieldIndex: null })}
        onSave={handleArrayConfigSave}
        initialSchema={fields[arrayConfigModal.fieldIndex ?? -1]?.arrayItemSchema}
        fieldName={fields[arrayConfigModal.fieldIndex ?? -1]?.key || 'Array Field'}
      />
    </>
  );
}
