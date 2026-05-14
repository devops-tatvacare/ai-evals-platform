import { useMemo } from 'react';

import { cn } from '@/utils/cn';
import type { CrmSchemaAttributeKey } from '@/features/crmWorkspace/queries/crmSchema';

/**
 * Phase 11D — generic renderer for a fact row's `attributes` JSONB,
 * driven by the manifest schema (no hardcoded column knowledge). The
 * schema's `semanticType` / `measureKind` / `dataType` decide formatting;
 * `pii` keys are masked unless `canViewPii` (wired by Phase 11E from
 * `applications.config.crmWorkspace.piiVisibility`).
 */
interface AttributesPanelProps {
  attributes: Record<string, unknown> | null | undefined;
  /** The per-discriminator attribute schema for this row's discriminator. */
  schema: Record<string, CrmSchemaAttributeKey>;
  canViewPii?: boolean;
  className?: string;
}

function _humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function _formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function _formatValue(value: unknown, spec: CrmSchemaAttributeKey | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (spec) {
    if (spec.dataType === 'boolean') {
      return value === true || value === 'true' ? 'Yes' : 'No';
    }
    if (
      spec.semanticType === 'duration' &&
      typeof value === 'number'
    ) {
      return _formatDuration(value);
    }
    if (spec.unit && typeof value === 'number') {
      return `${value} ${spec.unit}`;
    }
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AttributesPanel({
  attributes,
  schema,
  canViewPii = false,
  className,
}: AttributesPanelProps) {
  const rows = useMemo(() => {
    const attrs = attributes ?? {};
    // Render every observed key; schema drives formatting + masking. Keys
    // with no schema entry still show (raw) so nothing is silently hidden.
    return Object.keys(attrs)
      .sort()
      .map((key) => {
        const spec = schema[key];
        const isPii = Boolean(spec?.pii);
        const masked = isPii && !canViewPii;
        return {
          key,
          label: _humanizeKey(key),
          isPii,
          isEnum: Boolean(spec?.allowedValues?.length),
          display: masked ? '•••••••' : _formatValue(attrs[key], spec),
          description: spec?.description ?? null,
        };
      });
  }, [attributes, schema, canViewPii]);

  if (rows.length === 0) {
    return (
      <p className={cn('text-[12px] text-tertiary', className)}>
        No attributes.
      </p>
    );
  }

  return (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-2', className)}>
      {rows.map((row) => (
        <div key={row.key} className="min-w-0">
          <dt
            className="text-[11px] font-medium text-tertiary"
            title={row.description ?? undefined}
          >
            {row.label}
            {row.isPii && (
              <span className="ml-1 text-[10px] uppercase text-amber-400">
                pii
              </span>
            )}
          </dt>
          <dd
            className={cn(
              'truncate text-[12px] text-primary',
              row.isEnum &&
                'inline-flex rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5',
            )}
            title={typeof row.display === 'string' ? row.display : undefined}
          >
            {row.display}
          </dd>
        </div>
      ))}
    </dl>
  );
}
