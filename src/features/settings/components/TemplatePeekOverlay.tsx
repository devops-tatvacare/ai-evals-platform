import { useEffect, useRef, useMemo } from 'react';
import { X, GitFork, Pencil } from 'lucide-react';
import { Badge, Button, Tabs, VisibilityBadge } from '@/components/ui';
import { cn } from '@/utils';
import type { EvalTemplate, EvalTemplateOutputField } from '@/types';

interface TemplatePeekOverlayProps {
  template: EvalTemplate | null;
  onClose: () => void;
}

const VARIABLE_RE = /\{\{(\w+)\}\}/g;

function HighlightedPrompt({ text, variables }: { text: string; variables: string[] }) {
  const varSet = useMemo(() => new Set(variables), [variables]);
  const parts: { text: string; isVar: boolean }[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(VARIABLE_RE)) {
    const idx = match.index!;
    if (idx > lastIndex) {
      parts.push({ text: text.slice(lastIndex, idx), isVar: false });
    }
    parts.push({ text: match[0], isVar: varSet.has(match[1]) });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isVar: false });
  }

  return (
    <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) =>
        p.isVar ? (
          <Badge key={i} variant="primary" size="sm" className="font-mono inline-flex align-baseline mx-0.5">
            {p.text}
          </Badge>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </pre>
  );
}

function SchemaFieldsView({ fields }: { fields: EvalTemplateOutputField[] }) {
  return (
    <div className="space-y-1.5">
      {fields.map((f) => (
        <div
          key={f.key}
          className="flex items-center gap-3 px-3 py-2 rounded-md bg-[var(--bg-secondary)]/50 border border-[var(--border-subtle)]"
        >
          <span className="font-mono text-[12px] text-[var(--text-primary)] min-w-[100px]">{f.key}</span>
          <Badge variant="neutral" size="sm">{f.type}</Badge>
          <Badge
            variant={f.displayMode === 'header' ? 'info' : f.displayMode === 'card' ? 'primary' : 'neutral'}
            size="sm"
          >
            {f.displayMode}
          </Badge>
          {f.role && (
            <Badge variant={f.role === 'metric' ? 'success' : f.role === 'reasoning' ? 'warning' : 'neutral'} size="sm">
              {f.role}
            </Badge>
          )}
          {f.isMainMetric && <Badge variant="success" size="sm">main</Badge>}
          <span className="flex-1 text-[11px] text-[var(--text-muted)] truncate">{f.description}</span>
        </div>
      ))}
    </div>
  );
}

function SchemaJsonView({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export function TemplatePeekOverlay({ template, onClose }: TemplatePeekOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!template) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [template, onClose]);

  if (!template) return null;

  const isOutputFields = template.schemaFormat === 'output_fields' && Array.isArray(template.schemaData);

  const tabs = [
    {
      id: 'prompt',
      label: 'Prompt',
      content: (
        <div className="p-4 overflow-auto max-h-[calc(100vh-220px)]">
          <HighlightedPrompt text={template.prompt} variables={template.variablesUsed} />
        </div>
      ),
    },
    {
      id: 'schema',
      label: 'Schema',
      content: (
        <div className="p-4 overflow-auto max-h-[calc(100vh-220px)]">
          {isOutputFields ? (
            <SchemaFieldsView fields={template.schemaData as EvalTemplateOutputField[]} />
          ) : (
            <SchemaJsonView data={template.schemaData as Record<string, unknown>} />
          )}
        </div>
      ),
    },
    {
      id: 'history',
      label: 'History',
      content: (
        <div className="p-4 text-[13px] text-[var(--text-muted)]">
          Version history coming soon.
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-[380px]',
          'bg-[var(--bg-primary)] border-l border-[var(--border-default)]',
          'flex flex-col shadow-lg'
        )}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)] truncate pr-2">
              {template.name}
            </h3>
            <button
              onClick={onClose}
              className="shrink-0 p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="neutral" size="sm">v{template.version}</Badge>
            {template.ownerName && (
              <span className="text-[11px] text-[var(--text-muted)]">{template.ownerName}</span>
            )}
            {template.visibility && <VisibilityBadge visibility={template.visibility} compact />}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <Button variant="ghost" size="sm" className="gap-1.5 text-[12px]" disabled>
              <GitFork className="h-3.5 w-3.5" />
              Fork
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-[12px]" disabled>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        </div>

        {/* Tabs content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <Tabs tabs={tabs} fillHeight />
        </div>
      </div>
    </>
  );
}
