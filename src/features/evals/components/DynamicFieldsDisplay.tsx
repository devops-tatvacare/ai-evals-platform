import { cn } from '@/utils';
import { TextDisplay, NumberDisplay, ArrayDisplay, BooleanDisplay } from './field-displays';
import type { EvaluatorOutputField } from '@/types';

interface DynamicFieldsDisplayProps {
  fields: EvaluatorOutputField[];
  data: Record<string, unknown>;
  className?: string;
}

export function DynamicFieldsDisplay({ fields, data, className }: DynamicFieldsDisplayProps) {
  if (!fields || fields.length === 0) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        No output fields configured
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {fields.map(field => (
        <FieldRenderer
          key={field.key}
          field={field}
          value={data[field.key]}
        />
      ))}
    </div>
  );
}

interface FieldRendererProps {
  field: EvaluatorOutputField;
  value: unknown;
}

function FieldRenderer({ field, value }: FieldRendererProps) {
  return (
    <div className="space-y-2">
      {/* Field Label */}
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {field.key.replace(/_/g, ' ')}
      </div>

      {/* Field Value - type-specific rendering */}
      <div>
        {field.type === 'text' && <TextDisplay value={value} />}
        {field.type === 'number' && (
          <NumberDisplay value={value} thresholds={field.thresholds} />
        )}
        {field.type === 'array' && (
          <ArrayDisplay value={value} schema={field.arrayItemSchema} />
        )}
        {field.type === 'boolean' && <BooleanDisplay value={value} />}
      </div>
    </div>
  );
}
