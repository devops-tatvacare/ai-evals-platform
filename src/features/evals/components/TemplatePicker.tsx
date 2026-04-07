import { X } from 'lucide-react';
import type { EvalTemplate, EvalTemplateOutputField } from '@/types';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/utils';

interface TemplatePickerProps {
  templates: EvalTemplate[];
  selectedId: string | null;
  onChange: (template: EvalTemplate | null) => void;
  currentUserId?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function getOutputFields(template: EvalTemplate): EvalTemplateOutputField[] {
  if (Array.isArray(template.schemaData)) {
    return template.schemaData as EvalTemplateOutputField[];
  }
  return [];
}

export function TemplatePicker({ templates, selectedId, onChange, currentUserId }: TemplatePickerProps) {
  const options = templates.map((t) => {
    const isOwner = currentUserId && t.userId === currentUserId;
    const ownerLabel = isOwner ? 'you' : (t.ownerName ?? 'shared');
    return {
      value: t.id,
      label: `${t.name} · v${t.version} · ${ownerLabel}`,
      searchText: t.name,
    };
  });

  const selected = selectedId ? templates.find((t) => t.id === selectedId) ?? null : null;
  const fields = selected ? getOutputFields(selected) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchableSelect
          value={selectedId ?? ''}
          onChange={(val) => {
            if (!val) {
              onChange(null);
              return;
            }
            const t = templates.find((tmpl) => tmpl.id === val) ?? null;
            onChange(t);
          }}
          options={options}
          placeholder="Select a template..."
          className="flex-1"
        />
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex items-center gap-1 rounded-[6px] px-2 py-1.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      {selected && (
        <div className="grid grid-cols-2 gap-3">
          {/* Prompt card */}
          <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Prompt
            </span>
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed break-words">
              {truncate(selected.prompt, 200)}
            </p>
            {selected.variablesUsed.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selected.variablesUsed.map((v) => (
                  <Badge key={v} variant="info" size="sm">
                    {`{{${v}}}`}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Schema card */}
          <div className="rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Schema
            </span>
            {fields.length > 0 ? (
              <>
                <span className="text-[12px] text-[var(--text-secondary)]">
                  {fields.length} field{fields.length !== 1 ? 's' : ''}
                </span>
                <div className="flex flex-wrap gap-1">
                  {fields.map((f) => (
                    <span
                      key={f.key}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-mono',
                        'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
                      )}
                    >
                      {f.key}
                      {f.isMainMetric && (
                        <Badge variant="primary" size="sm" className="ml-0.5">
                          MAIN
                        </Badge>
                      )}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-[12px] text-[var(--text-muted)]">No output fields defined</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
