import { useMemo, useEffect } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';
import { Button } from '@/components/ui';
import { useCurrentSchemas, useCurrentSchemasActions } from '@/hooks';
import { cn } from '@/utils';
import type { SchemaDefinition } from '@/types';

interface SchemaSelectorProps {
  promptType: 'transcription' | 'evaluation' | 'extraction';
  value: SchemaDefinition | null;
  onChange: (schema: SchemaDefinition | null) => void;
  onEditClick?: () => void;
  showPreview?: boolean;
  compact?: boolean;
  className?: string;
  /** Slot for inline schema generator */
  generatorSlot?: React.ReactNode;
  /** Option to derive schema from structured output (Phase 2) */
  onDeriveFromStructured?: () => void;
  canDeriveFromStructured?: boolean;
}

const PROMPT_TYPE_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  evaluation: 'Evaluation',
  extraction: 'Extraction',
};

export function SchemaSelector({
  promptType,
  value,
  onChange,
  onEditClick,
  showPreview = false,
  compact = false,
  className,
  generatorSlot,
  onDeriveFromStructured,
  canDeriveFromStructured = false,
}: SchemaSelectorProps) {
  const schemas = useCurrentSchemas();
  const { loadSchemas } = useCurrentSchemasActions();

  // Get schemas for this type
  const typeSchemas = useMemo(
    () => schemas.filter((s) => s.promptType === promptType),
    [schemas, promptType]
  );

  // Load schemas on mount
  useEffect(() => {
    loadSchemas();
  }, [loadSchemas]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    
    // Phase 2: Handle "Derive from Structured Output" option
    if (selectedId === '__derive__') {
      if (onDeriveFromStructured) {
        onDeriveFromStructured();
      }
      return;
    }
    
    if (!selectedId) {
      onChange(null);
      return;
    }
    const selected = typeSchemas.find((s) => s.id === selectedId);
    if (selected) {
      onChange(selected);
    }
  };

  if (compact) {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-muted)] shrink-0">Output Schema:</span>
          <div className="relative flex-1">
            <select
              value={value?.id || ''}
              onChange={handleChange}
              className="w-full h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-3 pr-8 text-[12px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 appearance-none cursor-pointer"
            >
              <option value="">— Select Schema —</option>
              {canDeriveFromStructured && (
                <option value="__derive__">✨ Derive from Structured Output</option>
              )}
              {typeSchemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name}
                  {schema.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
          </div>
          {onEditClick && value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEditClick}
              className="h-8 w-8 p-0"
              title="Edit schema"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {generatorSlot}
        </div>
        {showPreview && value && (
          <p className="text-[11px] text-[var(--text-muted)] truncate pl-[85px]">
            {value.description || `Version ${value.version}`}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <label className="block text-[13px] font-medium text-[var(--text-primary)]">
        {PROMPT_TYPE_LABELS[promptType]} Output Schema
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <select
            value={value?.id || ''}
            onChange={handleChange}
            className="w-full h-9 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-3 pr-8 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 appearance-none cursor-pointer"
          >
            <option value="">— Select Schema —</option>
            {canDeriveFromStructured && (
              <option value="__derive__">✨ Derive from Structured Output</option>
            )}
            {typeSchemas.map((schema) => (
              <option key={schema.id} value={schema.id}>
                {schema.name}
                {schema.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
        </div>
        {onEditClick && value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEditClick}
            className="h-9 gap-1.5"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
        {generatorSlot}
      </div>
      {showPreview && value && (
        <p className="text-[12px] text-[var(--text-secondary)]">
          {value.description || `Version ${value.version}`}
        </p>
      )}
    </div>
  );
}
