import { Button, Input } from '@/components/ui';
import { Plus, Trash2 } from 'lucide-react';
import type { EvaluatorOutputField, EvaluatorFieldType } from '@/types';

interface OutputSchemaBuilderProps {
  fields: EvaluatorOutputField[];
  onChange: (fields: EvaluatorOutputField[]) => void;
}

export function OutputSchemaBuilder({ fields, onChange }: OutputSchemaBuilderProps) {
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
  
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Output Definition</label>
        <Button variant="ghost" size="sm" onClick={addField}>
          <Plus className="h-4 w-4 mr-1" />
          Add Field
        </Button>
      </div>
      
      {fields.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded-md p-4 text-center">
          No output fields defined. Add at least one field to capture LLM output.
        </div>
      ) : (
        <div className="border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Key Name</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Description</th>
                <th className="text-left p-2">Display</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <tr key={index} className="border-t">
                  <td className="p-2">
                    <Input
                      value={field.key}
                      onChange={(e) => updateField(index, { key: e.target.value })}
                      placeholder="score"
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <select
                      value={field.type}
                      onChange={(e) => updateField(index, { type: e.target.value as EvaluatorFieldType })}
                      className="h-8 w-full text-xs border rounded px-2"
                    >
                      <option value="number">Number</option>
                      <option value="text">Text</option>
                      <option value="boolean">Boolean</option>
                      <option value="array">Array</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <Input
                      value={field.description}
                      onChange={(e) => updateField(index, { description: e.target.value })}
                      placeholder="For AI to understand"
                      className="h-8 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <div className="space-y-1">
                      <label className="flex items-center text-xs">
                        <input
                          type="radio"
                          name={`display-${index}`}
                          checked={field.displayMode === 'header'}
                          onChange={() => updateField(index, { displayMode: 'header', isMainMetric: true })}
                          className="mr-1"
                        />
                        Header
                      </label>
                      <label className="flex items-center text-xs">
                        <input
                          type="radio"
                          name={`display-${index}`}
                          checked={field.displayMode === 'card'}
                          onChange={() => updateField(index, { displayMode: 'card', isMainMetric: false })}
                          className="mr-1"
                        />
                        Card Body
                      </label>
                      <label className="flex items-center text-xs">
                        <input
                          type="radio"
                          name={`display-${index}`}
                          checked={field.displayMode === 'hidden'}
                          onChange={() => updateField(index, { displayMode: 'hidden', isMainMetric: false })}
                          className="mr-1"
                        />
                        Hidden
                      </label>
                    </div>
                  </td>
                  <td className="p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeField(index)}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
