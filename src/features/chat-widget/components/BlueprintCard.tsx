import { useState } from 'react';
import { Copy, Ruler, Save } from 'lucide-react';
import { Button, Tooltip } from '@/components/ui';
import { notificationService } from '@/services/notifications';
import { reportsApi } from '@/services/api/reportsApi';
import { buildComposedReportOutline } from '../chatWidgetHelpers';
import type { BlueprintPart, SaveToastPart } from '../types';
import { getSectionTypeMeta } from './sectionTypeMeta';

interface BlueprintCardProps {
  part: BlueprintPart;
  appId: string;
  sessionId: string | null;
  onSaved?: (nextPart: BlueprintPart, toast: SaveToastPart) => void;
}

export function BlueprintCard({ part, appId, sessionId, onSaved }: BlueprintCardProps) {
  const [saving, setSaving] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildComposedReportOutline({
      reportName: part.name,
      sections: part.sections,
    }));
    notificationService.success('Blueprint outline copied');
  };

  const handleSave = async () => {
    if (saving || part.saved) {
      return;
    }
    setSaving(true);
    try {
      const saved = await reportsApi.saveBlueprint({
        appId,
        name: part.name,
        sections: part.sections.map((section) => ({
          id: section.id,
          type: section.type,
          title: section.title,
          variant: section.variant,
        })),
        sourceSessionId: sessionId ?? undefined,
      });
      onSaved?.(
        { ...part, saved: true, blueprintId: saved.reportId },
        {
          type: 'save-toast',
          variant: 'blueprint',
          title: 'Blueprint saved',
          subtitle: part.name,
        },
      );
      notificationService.success('Blueprint saved');
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to save blueprint');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-accent-purple)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent-purple)_10%,var(--bg-secondary))] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Ruler className="h-4 w-4 text-[var(--color-accent-purple)]" />
            <span className="truncate">{part.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {`${part.sections.length} section${part.sections.length === 1 ? '' : 's'}`}
          </div>
        </div>
        {part.saved ? (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--color-accent-purple)_18%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-accent-purple)]">
            Saved
          </span>
        ) : null}
      </div>
      <ol className="mt-2.5 space-y-1 text-sm text-[var(--text-primary)]">
        {part.sections.map((section, index) => {
          const meta = getSectionTypeMeta(section.type);
          return (
            <li
              key={section.id}
              className="flex items-center gap-2.5 rounded-lg bg-[color-mix(in_srgb,var(--bg-primary)_55%,transparent)] px-2.5 py-1.5"
            >
              <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-[var(--color-accent-purple)]">
                {index + 1}
              </span>
              <Tooltip content={meta.label} position="top">
                <span className="flex h-4 w-7 shrink-0 items-center justify-center">
                  {meta.glyph}
                </span>
              </Tooltip>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {section.title}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" icon={Copy} onClick={() => void handleCopy()}>
          Copy outline
        </Button>
        {part.saved ? null : (
          <Button
            variant="primary"
            size="sm"
            icon={Save}
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save blueprint'}
          </Button>
        )}
      </div>
    </div>
  );
}
