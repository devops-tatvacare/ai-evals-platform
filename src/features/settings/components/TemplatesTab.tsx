import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, FileText } from 'lucide-react';
import { Badge, Button, EmptyState, VisibilityBadge } from '@/components/ui';
import { useCurrentAppId } from '@/hooks';
import { useEvalTemplatesStore } from '@/stores/evalTemplatesStore';
import { useAuthStore } from '@/stores/authStore';
import { TemplatePeekOverlay } from './TemplatePeekOverlay';
import { cn } from '@/utils';
import type { EvalTemplate, TemplateType } from '@/types';

const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000001';

type TypeFilter = 'all' | TemplateType;
type OwnerFilter = 'mine' | 'shared' | 'system';

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'evaluation', label: 'Evaluation' },
  { value: 'transcription', label: 'Transcription' },
  { value: 'extraction', label: 'Extraction' },
];

const OWNER_OPTIONS: { value: OwnerFilter; label: string }[] = [
  { value: 'mine', label: 'My Templates' },
  { value: 'shared', label: 'Shared' },
  { value: 'system', label: 'System' },
];

function isSystemTemplate(t: EvalTemplate): boolean {
  return t.tenantId === SYSTEM_TENANT_ID || !!t.isDefault;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const TYPE_BADGE_VARIANT: Record<TemplateType, 'primary' | 'info' | 'warning'> = {
  evaluation: 'primary',
  transcription: 'info',
  extraction: 'warning',
};

export function TemplatesTab() {
  const appId = useCurrentAppId();
  const templates = useEvalTemplatesStore((s) => s.templates[appId] ?? []);
  const isLoaded = useEvalTemplatesStore((s) => s.isLoaded[appId] ?? false);
  const isLoading = useEvalTemplatesStore((s) => s.isLoading);
  const loadTemplates = useEvalTemplatesStore((s) => s.loadTemplates);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter | null>(null);
  const [peekTemplate, setPeekTemplate] = useState<EvalTemplate | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      loadTemplates(appId, { latestOnly: true });
    }
  }, [appId, isLoaded, loadTemplates]);

  const filtered = useMemo(() => {
    let list = templates;

    if (typeFilter !== 'all') {
      list = list.filter((t) => t.templateType === typeFilter);
    }

    if (ownerFilter === 'mine') {
      list = list.filter((t) => t.userId === currentUserId);
    } else if (ownerFilter === 'shared') {
      list = list.filter((t) => t.visibility === 'shared' && !isSystemTemplate(t));
    } else if (ownerFilter === 'system') {
      list = list.filter(isSystemTemplate);
    }

    return list;
  }, [templates, typeFilter, ownerFilter, currentUserId]);

  const handleRowClick = useCallback((t: EvalTemplate) => {
    setPeekTemplate(t);
  }, []);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Type filter */}
        <div className="flex items-center rounded-md border border-[var(--border-subtle)] overflow-hidden">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium transition-colors',
                typeFilter === opt.value
                  ? 'bg-[var(--interactive-primary)] text-[var(--text-on-primary)]'
                  : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Ownership filter */}
        <div className="flex items-center rounded-md border border-[var(--border-subtle)] overflow-hidden">
          {OWNER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setOwnerFilter(ownerFilter === opt.value ? null : opt.value)}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium transition-colors',
                ownerFilter === opt.value
                  ? 'bg-[var(--interactive-primary)] text-[var(--text-on-primary)]'
                  : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <Button variant="primary" size="sm" className="gap-1.5" disabled>
          <Plus className="h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      {/* Table */}
      {isLoading && !isLoaded ? (
        <div className="py-12 text-center text-[13px] text-[var(--text-muted)]">Loading templates...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No templates found"
          description={ownerFilter || typeFilter !== 'all' ? 'Try adjusting your filters.' : 'No templates available for this app yet.'}
          compact
        />
      ) : (
        <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_100px_60px_160px_90px_100px] gap-2 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <span>Name</span>
            <span>Type</span>
            <span>Ver</span>
            <span>Variables</span>
            <span>Visibility</span>
            <span>Updated</span>
          </div>

          {/* Rows */}
          {filtered.map((t) => {
            const system = isSystemTemplate(t);
            return (
              <button
                key={t.id}
                onClick={() => handleRowClick(t)}
                className={cn(
                  'w-full grid grid-cols-[1fr_100px_60px_160px_90px_100px] gap-2 px-4 py-2.5 text-left border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--bg-secondary)]/50 transition-colors',
                  system && 'opacity-75'
                )}
              >
                {/* Name + description */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-[var(--text-primary)] truncate">{t.name}</span>
                    {system && <Badge variant="warning" size="sm">SYSTEM</Badge>}
                  </div>
                  {t.description && (
                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{t.description}</p>
                  )}
                </div>

                {/* Type */}
                <div className="flex items-center">
                  <Badge variant={TYPE_BADGE_VARIANT[t.templateType]} size="sm">
                    {t.templateType}
                  </Badge>
                </div>

                {/* Version */}
                <div className="flex items-center text-[13px] text-[var(--text-secondary)]">
                  v{t.version}
                </div>

                {/* Variables */}
                <div className="flex items-center gap-1 flex-wrap">
                  {t.variablesUsed.length === 0 ? (
                    <span className="text-[11px] text-[var(--text-muted)]">--</span>
                  ) : (
                    t.variablesUsed.slice(0, 3).map((v) => (
                      <Badge key={v} variant="neutral" size="sm" className="font-mono">
                        {v}
                      </Badge>
                    ))
                  )}
                  {t.variablesUsed.length > 3 && (
                    <span className="text-[11px] text-[var(--text-muted)]">+{t.variablesUsed.length - 3}</span>
                  )}
                </div>

                {/* Visibility */}
                <div className="flex items-center">
                  {t.visibility ? (
                    <VisibilityBadge visibility={t.visibility} compact />
                  ) : (
                    <span className="text-[11px] text-[var(--text-muted)]">--</span>
                  )}
                </div>

                {/* Updated */}
                <div className="flex items-center text-[12px] text-[var(--text-muted)]">
                  {formatDate(t.updatedAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Peek overlay */}
      <TemplatePeekOverlay template={peekTemplate} onClose={() => setPeekTemplate(null)} />
    </div>
  );
}
