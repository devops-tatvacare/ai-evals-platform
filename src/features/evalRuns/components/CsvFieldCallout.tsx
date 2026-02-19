import { useState } from 'react';
import { TableProperties, ChevronDown, ChevronRight, CircleDot, CircleDashed } from 'lucide-react';
import { cn } from '@/utils';
import { CSV_FIELD_SCHEMA, type CsvFieldDef } from '../utils/csvSchema';

const GROUP_LABELS: Record<CsvFieldDef['group'], string> = {
  identity: 'Identity',
  content: 'Content',
  metadata: 'Metadata',
};

const GROUP_ORDER: CsvFieldDef['group'][] = ['content', 'identity', 'metadata'];

/**
 * Pre-upload callout that shows the required CSV field schema.
 * Groups fields by semantic category with required/optional indicators.
 */
export function CsvFieldCallout() {
  const [expanded, setExpanded] = useState(false);
  const requiredCount = CSV_FIELD_SCHEMA.filter((f) => f.required).length;

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[var(--bg-secondary)] transition-colors"
      >
        <TableProperties className="h-4 w-4 text-[var(--color-info)] shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">
            Required CSV Format
          </span>
          <span className="ml-2 text-[11px] text-[var(--text-muted)]">
            {requiredCount} required, {CSV_FIELD_SCHEMA.length - requiredCount} optional fields
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3.5 py-3 space-y-3">
          {GROUP_ORDER.map((group) => {
            const fields = CSV_FIELD_SCHEMA.filter((f) => f.group === group);
            return (
              <div key={group}>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--text-muted)] mb-1.5">
                  {GROUP_LABELS[group]}
                </p>
                <div className="space-y-1">
                  {fields.map((field) => (
                    <div
                      key={field.name}
                      className="flex items-start gap-2 py-1 px-2 rounded text-[12px]"
                    >
                      {field.required ? (
                        <CircleDot className="h-3 w-3 text-[var(--color-info)] shrink-0 mt-0.5" />
                      ) : (
                        <CircleDashed className="h-3 w-3 text-[var(--text-tertiary)] shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <code className={cn(
                            'font-mono text-[11px] px-1 py-px rounded',
                            field.required
                              ? 'bg-[var(--color-info-light)] text-[var(--color-info)]'
                              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                          )}>
                            {field.name}
                          </code>
                          {!field.required && (
                            <span className="text-[10px] text-[var(--text-tertiary)] italic">optional</span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                          {field.description}
                          <span className="text-[var(--text-tertiary)]"> — e.g. </span>
                          <code className="text-[10px] font-mono text-[var(--text-secondary)]">{field.example || '(empty)'}</code>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
