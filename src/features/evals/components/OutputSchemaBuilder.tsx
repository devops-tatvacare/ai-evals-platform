import { Button, Input, EmptyState, Select } from '@/components/ui';
import { Plus, Trash2, ListPlus } from 'lucide-react';
import { cn } from '@/utils';
import type { EvaluatorOutputField, EvaluatorFieldType } from '@/types';

interface OutputSchemaBuilderProps {
  fields: EvaluatorOutputField[];
  onChange: (fields: EvaluatorOutputField[]) => void;
  /** Show the Display column (header / card / hidden). Defaults to true.
   *  Pass false in surfaces where display layout is not relevant (e.g. template authoring).
   *  When false, every new field is created with displayMode: 'card'. */
  showDisplayMode?: boolean;
  /** Show the section heading + Add Field button row. Defaults to true.
   *  Pass false when the parent surface already provides its own header. */
  showHeader?: boolean;
}

export function OutputSchemaBuilder({
  fields,
  onChange,
  showDisplayMode = true,
  showHeader = true,
}: OutputSchemaBuilderProps) {
  const addField = () => {
    const newField: EvaluatorOutputField = {
      key: '',
      type: 'text',
      description: '',
      displayMode: 'card',
      isMainMetric: false,
    };
    onChange([...fields, newField]);
  };

  const updateField = (index: number, updates: Partial<EvaluatorOutputField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };

    // Ensure only one main metric
    if (updates.displayMode === 'header' && updates.isMainMetric) {
      newFields.forEach((f, i) => {
        if (i !== index) f.isMainMetric = false;
      });
    }

    onChange(newFields);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  const gridCols = showDisplayMode
    ? 'grid-cols-[1.2fr_120px_1.5fr_140px_36px]'
    : 'grid-cols-[1.2fr_120px_1.5fr_36px]';

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="flex items-center justify-between">
          <label className="text-[12px] font-medium text-[var(--text-secondary)]">Output Definition</label>
          <Button variant="ghost" size="sm" onClick={addField} className="gap-1 text-[12px]">
            <Plus className="h-3.5 w-3.5" />
            Add Field
          </Button>
        </div>
      )}

      {fields.length === 0 ? (
        <EmptyState
          icon={ListPlus}
          title="No output fields defined"
          description="Add at least one field to capture LLM output."
          compact
        />
      ) : (
        <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30 overflow-hidden">
          {/* Header row */}
          <div
            className={cn(
              'grid gap-2 px-3 py-2 bg-[var(--bg-secondary)]/60 border-b border-[var(--border-subtle)]',
              'text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]',
              gridCols,
            )}
          >
            <span>Key</span>
            <span>Type</span>
            <span>Description</span>
            {showDisplayMode && <span>Display</span>}
            <span />
          </div>

          {/* Field rows */}
          <div className="divide-y divide-[var(--border-subtle)]">
            {fields.map((field, index) => (
              <div
                key={index}
                className={cn('grid gap-2 px-3 py-2 items-start', gridCols)}
              >
                <Input
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value })}
                  placeholder="score"
                  className="h-8 text-[12px]"
                />
                <Select
                  value={field.type}
                  onChange={(val) => updateField(index, { type: val as EvaluatorFieldType })}
                  options={[
                    { value: 'number', label: 'Number' },
                    { value: 'text', label: 'Text' },
                    { value: 'boolean', label: 'Boolean' },
                    { value: 'array', label: 'Array' },
                  ]}
                  size="sm"
                />
                <Input
                  value={field.description}
                  onChange={(e) => updateField(index, { description: e.target.value })}
                  placeholder="For AI to understand"
                  className="h-8 text-[12px]"
                />
                {showDisplayMode && (
                  <div className="flex flex-col gap-0.5">
                    {(['header', 'card', 'hidden'] as const).map((mode) => (
                      <label
                        key={mode}
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] cursor-pointer"
                      >
                        <input
                          type="radio"
                          name={`display-${index}`}
                          checked={field.displayMode === mode}
                          onChange={() =>
                            updateField(index, {
                              displayMode: mode,
                              isMainMetric: mode === 'header',
                            })
                          }
                          className="accent-[var(--interactive-primary)]"
                        />
                        {mode === 'header' ? 'Header' : mode === 'card' ? 'Card' : 'Hidden'}
                      </label>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeField(index)}
                  aria-label="Remove field"
                  className={cn(
                    'h-8 w-8 inline-flex items-center justify-center rounded-[6px]',
                    'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--color-error)]',
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!showHeader && (
        <Button variant="ghost" size="sm" onClick={addField} className="gap-1 text-[12px]">
          <Plus className="h-3.5 w-3.5" />
          Add Field
        </Button>
      )}
    </div>
  );
}
