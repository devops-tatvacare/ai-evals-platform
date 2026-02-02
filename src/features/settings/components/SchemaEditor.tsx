import { useState, useCallback, useMemo, useEffect } from 'react';
import { Save, Sparkles, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui';
import { useCurrentSchemas, useCurrentSchemasActions } from '@/hooks';
import type { SchemaDefinition } from '@/types';

interface SchemaEditorProps {
  promptType: 'transcription' | 'evaluation' | 'extraction';
  value: SchemaDefinition | null;
  onChange: (schema: SchemaDefinition) => void;
  onGenerateClick: () => void;
  className?: string;
}

const PROMPT_TYPE_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  evaluation: 'Evaluation',
  extraction: 'Extraction',
};

export function SchemaEditor({
  promptType,
  value,
  onChange,
  onGenerateClick,
  className,
}: SchemaEditorProps) {
  const schemas = useCurrentSchemas();
  const { loadSchemas, saveSchema } = useCurrentSchemasActions();
  const [schemaText, setSchemaText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Get schemas for this type
  const typeSchemas = useMemo(
    () => schemas.filter((s) => s.promptType === promptType),
    [schemas, promptType]
  );

  // Load schemas on mount
  useEffect(() => {
    loadSchemas();
  }, [loadSchemas]);

  // Update text when value changes
  useEffect(() => {
    if (value) {
      setSchemaText(JSON.stringify(value.schema, null, 2));
      setValidationError(null);
    } else {
      setSchemaText('');
    }
  }, [value]);

  // Check if content has changed
  const hasChanges = useMemo(() => {
    if (!value) return schemaText.trim().length > 0;
    try {
      const current = JSON.parse(schemaText);
      return JSON.stringify(current) !== JSON.stringify(value.schema);
    } catch {
      return true;
    }
  }, [schemaText, value]);

  const validateSchema = useCallback((text: string): Record<string, unknown> | null => {
    if (!text.trim()) {
      setValidationError('Schema cannot be empty');
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      
      // Basic JSON Schema validation
      if (typeof parsed !== 'object' || parsed === null) {
        setValidationError('Schema must be an object');
        return null;
      }
      
      if (parsed.type !== 'object') {
        setValidationError('Root type must be "object"');
        return null;
      }
      
      if (!parsed.properties || typeof parsed.properties !== 'object') {
        setValidationError('Schema must have a "properties" object');
        return null;
      }

      setValidationError(null);
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setValidationError(message);
      return null;
    }
  }, []);

  const handleBlur = useCallback(() => {
    if (schemaText.trim()) {
      validateSchema(schemaText);
    }
  }, [schemaText, validateSchema]);

  const handleVersionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const selected = typeSchemas.find((s) => s.id === selectedId);
    if (selected) {
      onChange(selected);
    }
  }, [typeSchemas, onChange]);

  const handleSaveAsNew = useCallback(async () => {
    const parsed = validateSchema(schemaText);
    if (!parsed) return;

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const newSchema = await saveSchema({
        promptType,
        schema: parsed,
        description: `Custom ${PROMPT_TYPE_LABELS[promptType]} schema`,
      });
      onChange(newSchema);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save schema';
      setValidationError(message);
    } finally {
      setIsSaving(false);
    }
  }, [schemaText, validateSchema, saveSchema, promptType, onChange]);

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <select
          value={value?.id || ''}
          onChange={handleVersionChange}
          className="flex-1 h-9 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
        >
          <option value="" disabled>
            Select {PROMPT_TYPE_LABELS[promptType]} Schema
          </option>
          {typeSchemas.map((schema) => (
            <option key={schema.id} value={schema.id}>
              {schema.name}
              {schema.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          onClick={onGenerateClick}
          className="gap-1.5 h-9"
        >
          <Sparkles className="h-4 w-4" />
          Generate
        </Button>
      </div>

      {/* Editor */}
      <textarea
        value={schemaText}
        onChange={(e) => setSchemaText(e.target.value)}
        onBlur={handleBlur}
        rows={10}
        placeholder={`{\n  "type": "object",\n  "properties": {\n    ...\n  },\n  "required": [...]\n}`}
        className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
      />

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex-1">
          {validationError && (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-error)]">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{validationError}</span>
            </div>
          )}
          {saveSuccess && (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-success)]">
              <Check className="h-3.5 w-3.5" />
              <span>Schema saved as new version</span>
            </div>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSaveAsNew}
          disabled={!hasChanges || !!validationError || isSaving}
          isLoading={isSaving}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          Save as New Version
        </Button>
      </div>
    </div>
  );
}
