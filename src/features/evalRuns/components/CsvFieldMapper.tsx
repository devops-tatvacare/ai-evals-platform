import { useMemo } from 'react';
import { ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/utils';
import { CSV_FIELD_SCHEMA, REQUIRED_FIELDS, type ColumnMapping } from '../utils/csvSchema';

interface CsvFieldMapperProps {
  /** All column headers found in the uploaded CSV */
  csvHeaders: string[];
  /** Current mapping: target schema field → source CSV column */
  mapping: ColumnMapping;
  /** Called when user changes a mapping */
  onMappingChange: (mapping: ColumnMapping) => void;
  /** Required fields that are missing from the CSV headers */
  missingFields: string[];
}

/**
 * Field mapping UI shown when CSV headers don't match the expected schema.
 * Lets the user map their CSV columns to the required target fields.
 */
export function CsvFieldMapper({ csvHeaders, mapping, onMappingChange, missingFields }: CsvFieldMapperProps) {
  // Available CSV columns for mapping (those not already used by another mapping)
  const usedSources = useMemo(() => {
    const used = new Set<string>();
    for (const [, source] of mapping) {
      used.add(source.toLowerCase());
    }
    return used;
  }, [mapping]);

  const allMapped = missingFields.every((f) => mapping.has(f));
  const requiredSet = new Set(REQUIRED_FIELDS);

  const handleFieldMap = (targetField: string, sourceColumn: string) => {
    const next = new Map(mapping);
    if (sourceColumn === '') {
      next.delete(targetField);
    } else {
      next.set(targetField, sourceColumn);
    }
    onMappingChange(next);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-warning)]" />
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          {missingFields.length} required {missingFields.length === 1 ? 'column' : 'columns'} not found
        </span>
        {allMapped && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)]">
            <CheckCircle2 className="h-3 w-3" />
            All mapped
          </span>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">
        Map your CSV columns to the expected fields below. Only required missing columns are shown.
      </p>

      <div className="space-y-1.5">
        {missingFields.map((targetField) => {
          const fieldDef = CSV_FIELD_SCHEMA.find((f) => f.name === targetField);
          const currentSource = mapping.get(targetField) ?? '';
          const isRequired = requiredSet.has(targetField);
          const isMapped = currentSource !== '';

          return (
            <div
              key={targetField}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md border transition-colors',
                isMapped
                  ? 'border-[var(--border-success)] bg-[var(--surface-success)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-secondary)]/50',
              )}
            >
              {/* Target field */}
              <div className="flex-1 min-w-0">
                <code className={cn(
                  'font-mono text-[11px] px-1 py-px rounded',
                  isRequired
                    ? 'bg-[var(--color-info-light)] text-[var(--color-info)]'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                )}>
                  {targetField}
                </code>
                {fieldDef && (
                  <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">{fieldDef.description}</span>
                )}
              </div>

              <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />

              {/* Source column picker */}
              <select
                value={currentSource}
                onChange={(e) => handleFieldMap(targetField, e.target.value)}
                className={cn(
                  'w-44 shrink-0 px-2 py-1 text-[11px] font-mono rounded border bg-[var(--bg-primary)] text-[var(--text-primary)]',
                  'focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]',
                  isMapped ? 'border-[var(--border-success)]' : 'border-[var(--border-default)]',
                )}
              >
                <option value="">— select column —</option>
                {csvHeaders.map((col) => {
                  const isUsed = usedSources.has(col.toLowerCase()) && currentSource.toLowerCase() !== col.toLowerCase();
                  return (
                    <option key={col} value={col} disabled={isUsed}>
                      {col}{isUsed ? ' (used)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
