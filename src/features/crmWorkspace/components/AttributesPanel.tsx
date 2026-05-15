import { useMemo } from 'react';
import { Gauge, Tag, KeyRound, FileText, Asterisk, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';
import { SectionBlock, type SectionBlockTone } from '@/components/ui';
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

/** Manifest-driven grouping. The `semanticType` taxonomy on each declared
 *  attribute key maps to a stable rendering category — Measures, Status,
 *  Identifiers, Content, Other. The mapping is the manifest's contract; no
 *  app or column hardcoding here. */
type AttrGroup = 'measure' | 'status' | 'identifier' | 'content' | 'other';

const GROUP_DEFS: Record<
  AttrGroup,
  { title: string; tone: SectionBlockTone; icon: LucideIcon; order: number }
> = {
  measure:    { title: 'Measures',    tone: 'info',    icon: Gauge,     order: 1 },
  status:     { title: 'Status',      tone: 'brand',   icon: Tag,       order: 2 },
  identifier: { title: 'Identifiers', tone: 'neutral', icon: KeyRound,  order: 3 },
  content:    { title: 'Content',     tone: 'neutral', icon: FileText,  order: 4 },
  other:      { title: 'Other',       tone: 'neutral', icon: Asterisk,  order: 5 },
};

function _groupFor(spec: CrmSchemaAttributeKey | undefined): AttrGroup {
  if (!spec) return 'other';
  if (spec.semanticType === 'duration' || spec.dataType === 'quantitative') return 'measure';
  if (spec.semanticType === 'category' || spec.dataType === 'boolean') return 'status';
  if (spec.semanticType === 'id_hash') return 'identifier';
  if (spec.semanticType === 'none') return 'content';
  return 'other';
}

export function AttributesPanel({
  attributes,
  schema,
  canViewPii = false,
  className,
}: AttributesPanelProps) {
  const grouped = useMemo(() => {
    const attrs = attributes ?? {};
    const byGroup = new Map<AttrGroup, Array<{
      key: string;
      label: string;
      isPii: boolean;
      isEnum: boolean;
      display: string;
      description: string | null;
    }>>();
    for (const key of Object.keys(attrs).sort()) {
      const spec = schema[key];
      const isPii = Boolean(spec?.pii);
      const masked = isPii && !canViewPii;
      const row = {
        key,
        label: _humanizeKey(key),
        isPii,
        isEnum: Boolean(spec?.allowedValues?.length),
        display: masked ? '•••••••' : _formatValue(attrs[key], spec),
        description: spec?.description ?? null,
      };
      const g = _groupFor(spec);
      const list = byGroup.get(g) ?? [];
      list.push(row);
      byGroup.set(g, list);
    }
    return Array.from(byGroup.entries())
      .sort(([a], [b]) => GROUP_DEFS[a].order - GROUP_DEFS[b].order);
  }, [attributes, schema, canViewPii]);

  if (grouped.length === 0) {
    return (
      <p className={cn('text-[12px] text-tertiary', className)}>
        No attributes.
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {grouped.map(([group, rows]) => {
        const def = GROUP_DEFS[group];
        return (
          <SectionBlock
            key={group}
            title={def.title}
            icon={def.icon}
            tone={def.tone}
            surface="tinted"
          >
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {rows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <dt
                    className="text-[11px] font-medium text-tertiary"
                    title={row.description ?? undefined}
                  >
                    {row.label}
                    {row.isPii && (
                      <span className="ml-1 text-[10px] uppercase text-[var(--color-warning)]">
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
          </SectionBlock>
        );
      })}
    </div>
  );
}
