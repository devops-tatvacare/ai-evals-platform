import { useId, useMemo, useRef, useState } from 'react';
import { X, Code2 } from 'lucide-react';
import {
  Button,
  Input,
  ConfirmDialog,
  VisibilityToggle,
  Alert,
  Tabs,
} from '@/components/ui';
import { useRightOverlay } from '@/hooks';
import { useEvalTemplatesStore } from '@/stores/evalTemplatesStore';
import { notificationService } from '@/services/notifications';
import { OutputSchemaBuilder } from '@/features/evals/components/OutputSchemaBuilder';
import {
  outputFieldsToJsonSchema,
  jsonSchemaToOutputFields,
  tryParseJson,
  cn,
} from '@/utils';
import type {
  AppId,
  AssetVisibility,
  EvaluatorOutputField,
  TemplateType,
  CreateTemplatePayload,
} from '@/types';

interface NewTemplateOverlayProps {
  open: boolean;
  appId: AppId;
  onClose: () => void;
  onCreated?: (templateId: string) => void;
}

type SchemaMode = 'builder' | 'json';

const TYPE_OPTIONS: { value: TemplateType; label: string; hint: string }[] = [
  { value: 'evaluation', label: 'Evaluation', hint: 'Score / judge model output' },
  { value: 'transcription', label: 'Transcription', hint: 'Convert audio / image to structured text' },
  { value: 'extraction', label: 'Extraction', hint: 'Pull structured fields from raw input' },
];

function emptyField(): EvaluatorOutputField {
  return { key: '', type: 'text', description: '', displayMode: 'card' };
}

function jsonPreview(fields: EvaluatorOutputField[]): string {
  return JSON.stringify(outputFieldsToJsonSchema(fields), null, 2);
}

export function NewTemplateOverlay({ open, appId, onClose, onCreated }: NewTemplateOverlayProps) {
  const titleId = useId();
  const ariaProps = useRightOverlay(open, { onClose, labelledBy: titleId });
  const panelRef = useRef<HTMLDivElement>(null);

  const createTemplate = useEvalTemplatesStore((s) => s.createTemplate);

  const [templateType, setTemplateType] = useState<TemplateType>('evaluation');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<AssetVisibility>('private');
  const [prompt, setPrompt] = useState('');

  const [mode, setMode] = useState<SchemaMode>('builder');
  const [fields, setFields] = useState<EvaluatorOutputField[]>([emptyField()]);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  /** Tracks whether the user has typed in the JSON tab.
   *  When false, entering the JSON tab reseeds from the live builder state.
   *  When true, we preserve the user's edits so tab-switching doesn't lose work. */
  const [jsonDirty, setJsonDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<SchemaMode>('builder');

  const [confirmSwitch, setConfirmSwitch] = useState<{ json: string; reason?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const builderInvalid = useMemo(() => {
    if (mode !== 'builder') return null;
    if (fields.length === 0) return 'Add at least one output field.';
    const seen = new Set<string>();
    for (const f of fields) {
      const key = f.key.trim();
      if (!key) return 'Every field needs a key.';
      if (seen.has(key)) return `Duplicate field key "${key}".`;
      seen.add(key);
    }
    return null;
  }, [mode, fields]);

  const jsonInvalid = useMemo(() => {
    if (mode !== 'json') return null;
    if (!jsonText.trim()) return 'Paste a JSON Schema.';
    const parsed = tryParseJson(jsonText);
    if (!parsed.ok) return `Invalid JSON: ${parsed.error}`;
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return 'Schema must be a JSON object.';
    }
    return null;
  }, [mode, jsonText]);

  const submitDisabled =
    !name.trim() ||
    !prompt.trim() ||
    !!builderInvalid ||
    !!jsonInvalid ||
    isSubmitting;

  const handleTabChange = (id: string) => {
    const next = id as SchemaMode;
    // When entering the JSON tab from builder mode and the user hasn't started
    // editing JSON yet, reseed the textarea with the live builder state so
    // they always see what their current rows look like as JSON.
    if (next === 'json' && mode === 'builder' && !jsonDirty) {
      setJsonText(jsonPreview(fields));
      setJsonError(null);
    }
    setActiveTab(next);
  };

  const handleApplyJsonToBuilder = () => {
    setJsonError(null);
    const parsed = tryParseJson(jsonText);
    if (!parsed.ok) {
      setJsonError(`Invalid JSON: ${parsed.error}`);
      return;
    }
    const result = jsonSchemaToOutputFields(parsed.value);
    if (result.ok) {
      setFields(result.fields);
      setJsonDirty(false);
      setActiveTab('builder');
      notificationService.success(
        `Imported ${result.fields.length} field${result.fields.length === 1 ? '' : 's'}`,
      );
      return;
    }
    // Not convertible — offer one-way switch to JSON mode
    setConfirmSwitch({ json: jsonText, reason: result.reason });
  };

  const handleUseAsJson = () => {
    setConfirmSwitch({ json: jsonText });
  };

  const performSwitchToJson = () => {
    if (!confirmSwitch) return;
    setJsonText(confirmSwitch.json);
    setJsonError(null);
    setMode('json');
    setJsonDirty(false);
    setActiveTab('json');
    setConfirmSwitch(null);
  };

  const handleSubmit = async () => {
    if (submitDisabled) return;
    setIsSubmitting(true);

    let schemaData: CreateTemplatePayload['schemaData'];
    let schemaFormat: string;

    if (mode === 'builder') {
      schemaData = fields;
      schemaFormat = 'output_fields';
    } else {
      const parsed = tryParseJson(jsonText);
      if (!parsed.ok) {
        setJsonError(`Invalid JSON: ${parsed.error}`);
        setIsSubmitting(false);
        return;
      }
      schemaData = parsed.value as Record<string, unknown>;
      schemaFormat = 'json_schema';
    }

    const payload: CreateTemplatePayload = {
      appId,
      templateType,
      name: name.trim(),
      description: description.trim() || undefined,
      prompt,
      schemaData,
      schemaFormat,
      visibility,
    };

    try {
      const created = await createTemplate(appId, payload);
      notificationService.success(`Created template "${created.name}"`);
      onCreated?.(created.id);
      onClose();
    } catch (err) {
      notificationService.error(err instanceof Error ? err.message : 'Failed to create template');
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[var(--z-overlay)] bg-black/30"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        {...ariaProps}
        ref={panelRef}
        className={cn(
          'fixed top-0 right-0 z-[var(--z-modal)] h-full w-[560px] max-w-[100vw]',
          'bg-[var(--bg-primary)] border-l border-[var(--border-default)]',
          'flex flex-col shadow-xl',
        )}
      >
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div>
            <h3 id={titleId} className="text-[15px] font-semibold text-[var(--text-primary)]">
              New Template
            </h3>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              Reusable prompt + schema, scoped to this app
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto px-5 py-4 space-y-5">
          {/* Type */}
          <Section label="Template Type">
            <div className="flex gap-2 flex-wrap">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTemplateType(opt.value)}
                  className={cn(
                    'flex-1 min-w-[150px] rounded-md border px-3 py-2 text-left transition-colors',
                    templateType === opt.value
                      ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]',
                  )}
                >
                  <div className="text-[13px] font-medium text-[var(--text-primary)]">{opt.label}</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{opt.hint}</div>
                </button>
              ))}
            </div>
          </Section>

          {/* Name + Description */}
          <Section label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Adherence judge v1"
              autoFocus
            />
          </Section>

          <Section label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this template is for"
            />
          </Section>

          {/* Visibility */}
          <Section label="Visibility">
            <VisibilityToggle value={visibility} onChange={setVisibility} variant="toolbar" />
          </Section>

          {/* Prompt */}
          <Section
            label="Prompt"
            required
            hint="Use {{variable}} placeholders for runtime substitution"
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={'You are evaluating {{response}} against {{criteria}}.\nReturn a numeric score and reasoning.'}
              rows={8}
              className={cn(
                'w-full rounded-[6px] border bg-[var(--bg-primary)] px-3 py-2 text-[13px] font-mono leading-relaxed text-[var(--text-primary)]',
                'placeholder:text-[var(--text-muted)] resize-y',
                'border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/40',
              )}
            />
          </Section>

          {/* Output schema */}
          <Section label="Output Schema" required>
            {mode === 'builder' ? (
              <Tabs
                key="schema-tabs-builder-mode"
                defaultTab={activeTab}
                onChange={handleTabChange}
                tabs={[
                  {
                    id: 'builder',
                    label: 'Builder',
                    content: (
                      <div className="space-y-2">
                        <OutputSchemaBuilder
                          fields={fields}
                          onChange={setFields}
                          showDisplayMode={false}
                          showHeader={false}
                        />
                        {builderInvalid && (
                          <p className="text-[11px] text-[var(--color-error)]">{builderInvalid}</p>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: 'json',
                    label: 'JSON',
                    content: (
                      <div className="space-y-2">
                        <p className="text-[11px] text-[var(--text-muted)]">
                          Paste from ChatGPT / Claude, or copy this for use elsewhere. Apply to import back into the builder, or lock as raw JSON.
                        </p>
                        <textarea
                          value={jsonText}
                          onChange={(e) => {
                            setJsonText(e.target.value);
                            setJsonError(null);
                            setJsonDirty(true);
                          }}
                          rows={12}
                          placeholder={'{"type":"object","properties":{"score":{"type":"number"}},"required":["score"]}'}
                          className={cn(
                            'w-full rounded-[6px] border bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-mono text-[var(--text-primary)]',
                            'placeholder:text-[var(--text-muted)] resize-y',
                            'border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/40',
                          )}
                        />
                        {jsonError && <Alert variant="error">{jsonError}</Alert>}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[12px]"
                            onClick={() => {
                              setJsonText(jsonPreview(fields));
                              setJsonError(null);
                              setJsonDirty(false);
                            }}
                            disabled={!jsonDirty}
                          >
                            Reset to builder state
                          </Button>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-[12px]"
                              onClick={handleUseAsJson}
                              disabled={!jsonText.trim()}
                            >
                              Use as JSON…
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              className="text-[12px]"
                              onClick={handleApplyJsonToBuilder}
                              disabled={!jsonText.trim()}
                            >
                              Apply to builder
                            </Button>
                          </div>
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <Tabs
                key="schema-tabs-json-mode"
                defaultTab="json"
                tabs={[
                  {
                    id: 'json',
                    label: 'JSON Schema',
                    content: (
                      <div className="space-y-2">
                        <span className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-1">
                          <Code2 className="h-3.5 w-3.5" />
                          JSON mode — one-way for this template
                        </span>
                        <textarea
                          value={jsonText}
                          onChange={(e) => {
                            setJsonText(e.target.value);
                            setJsonError(null);
                          }}
                          rows={14}
                          placeholder={'{"type":"object","properties":{...},"required":[...]}'}
                          className={cn(
                            'w-full rounded-[6px] border bg-[var(--bg-primary)] px-3 py-2 text-[12px] font-mono text-[var(--text-primary)]',
                            'placeholder:text-[var(--text-muted)] resize-y',
                            'border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/40',
                          )}
                        />
                        {jsonError && <Alert variant="error">{jsonError}</Alert>}
                        {jsonInvalid && !jsonError && (
                          <p className="text-[11px] text-[var(--color-error)]">{jsonInvalid}</p>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </Section>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {isSubmitting ? 'Creating…' : 'Create Template'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!confirmSwitch}
        onClose={() => setConfirmSwitch(null)}
        onConfirm={performSwitchToJson}
        title="Switch to JSON mode?"
        description={
          confirmSwitch?.reason
            ? `${confirmSwitch.reason} Switching loads this schema as raw JSON. The visual builder is one-way — you cannot return to it for this template.`
            : 'Switching loads the current schema as raw JSON. The visual builder is one-way — you cannot return to it for this template.'
        }
        confirmLabel="Switch to JSON"
        cancelLabel="Stay in builder"
        variant="warning"
      />
    </>
  );
}

function Section({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="text-[12px] font-medium text-[var(--text-secondary)]">
          {label}
          {required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
