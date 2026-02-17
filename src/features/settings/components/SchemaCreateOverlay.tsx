import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  X, Save, Sparkles, AlertCircle, Check, FileJson,
  ChevronRight, RefreshCw, Wand2, Pencil, Trash2,
} from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { useCurrentSchemas, useCurrentSchemasActions } from '@/hooks';
import { useLLMSettingsStore } from '@/stores';
import { GeminiProvider } from '@/services/llm';
import { SCHEMA_GENERATOR_SYSTEM_PROMPT } from '@/constants';
import { JsonViewer } from '@/features/structured-outputs/components/JsonViewer';
import type { SchemaDefinition } from '@/types';
import { cn } from '@/utils';

type PromptType = 'transcription' | 'evaluation' | 'extraction';
type OverlayTab = 'browse' | 'edit' | 'generate';

interface SchemaCreateOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: PromptType;
  initialSchema?: Record<string, unknown> | SchemaDefinition | null;
  onSave?: (schema: SchemaDefinition) => void;
}

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  transcription: 'Transcription',
  evaluation: 'Evaluation',
  extraction: 'Extraction',
};

const PROMPT_TYPE_PLACEHOLDERS: Record<PromptType, string> = {
  transcription: 'e.g., "Include confidence scores for each segment, add speaker emotion detection"',
  evaluation: 'e.g., "Add which transcript is likely correct, confidence levels, error categories"',
  extraction: 'e.g., "Extract patient demographics, medications with dosages, diagnoses"',
};

export function SchemaCreateOverlay({
  isOpen,
  onClose,
  promptType,
  initialSchema,
  onSave,
}: SchemaCreateOverlayProps) {
  const schemas = useCurrentSchemas();
  const { loadSchemas, saveSchema, deleteSchema } = useCurrentSchemasActions();
  const llm = useLLMSettingsStore();

  // Tab state
  const [activeTab, setActiveTab] = useState<OverlayTab>('browse');

  // Browse tab state
  const [selectedSchema, setSelectedSchema] = useState<SchemaDefinition | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Edit tab state
  const [schemaText, setSchemaText] = useState('');
  const [schemaName, setSchemaName] = useState('');
  const [schemaDescription, setSchemaDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Generate tab state
  const [userIdea, setUserIdea] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedSchema, setGeneratedSchema] = useState<Record<string, unknown> | null>(null);
  const [generateModel, setGenerateModel] = useState(llm.selectedModel || '');

  const typeSchemas = useMemo(
    () => schemas.filter((s) => s.promptType === promptType),
    [schemas, promptType],
  );

  // Load schemas on mount
  useEffect(() => {
    if (isOpen) {
      loadSchemas();
    }
  }, [isOpen, loadSchemas]);

  // Sync generate model with settings when overlay opens
  useEffect(() => {
    if (isOpen) {
      setGenerateModel(llm.selectedModel || '');
    }
  }, [isOpen, llm.selectedModel]);

  // Reset state when overlay opens
  useEffect(() => {
    if (isOpen) {
      const isSchemaDefinition = initialSchema && 'promptType' in initialSchema && 'schema' in initialSchema;
      const initialSchemaObj = isSchemaDefinition
        ? (initialSchema as SchemaDefinition).schema as Record<string, unknown>
        : initialSchema as Record<string, unknown> | undefined;
      setActiveTab(isSchemaDefinition ? 'edit' : 'browse');
      setSelectedSchema(isSchemaDefinition ? (initialSchema as SchemaDefinition) : null);
      setSchemaText(initialSchemaObj ? JSON.stringify(initialSchemaObj, null, 2) : '');
      setSchemaName(isSchemaDefinition ? (initialSchema as SchemaDefinition).name : '');
      setSchemaDescription(isSchemaDefinition ? ((initialSchema as SchemaDefinition).description || '') : '');
      setValidationError(null);
      setSaveSuccess(false);
      setUserIdea('');
      setGenerateError(null);
      setGeneratedSchema(null);
      setRenamingId(null);
    }
  }, [isOpen, initialSchema]);

  // Update schema text when selected schema changes
  useEffect(() => {
    if (selectedSchema) {
      setSchemaText(JSON.stringify(selectedSchema.schema, null, 2));
      setSchemaName(selectedSchema.name);
      setSchemaDescription(selectedSchema.description || '');
      setValidationError(null);
    }
  }, [selectedSchema]);

  const hasChanges = useMemo(() => {
    if (!selectedSchema) return schemaText.trim().length > 0;
    try {
      const current = JSON.parse(schemaText);
      return JSON.stringify(current) !== JSON.stringify(selectedSchema.schema);
    } catch {
      return true;
    }
  }, [schemaText, selectedSchema]);

  const validateSchema = useCallback((text: string): Record<string, unknown> | null => {
    if (!text.trim()) {
      setValidationError('Schema cannot be empty');
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        setValidationError('Schema must be an object');
        return null;
      }
      if (parsed.type !== 'object') {
        setValidationError('Root type must be "object"');
        return null;
      }
      if (!parsed.properties || typeof parsed.properties !== 'object') {
        setValidationError('Schema must have a "properties" object');
        return null;
      }
      setValidationError(null);
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setValidationError(message);
      return null;
    }
  }, []);

  const handleSaveAsNew = useCallback(async () => {
    const parsed = validateSchema(schemaText);
    if (!parsed) return;

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const newSchema = await saveSchema({
        promptType,
        schema: parsed,
        name: schemaName.trim() || undefined,
        description: schemaDescription.trim() || `Custom ${PROMPT_TYPE_LABELS[promptType]} schema`,
      });
      setSelectedSchema(newSchema);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save schema';
      setValidationError(message);
    } finally {
      setIsSaving(false);
    }
  }, [schemaText, schemaName, schemaDescription, validateSchema, saveSchema, promptType]);

  // Use selected schema → pass back to parent overlay
  const handleUseSchema = useCallback(() => {
    if (selectedSchema && onSave) {
      onSave(selectedSchema);
      onClose();
    }
  }, [selectedSchema, onSave, onClose]);

  // Save new and use immediately
  const handleSaveAndUse = useCallback(async () => {
    const parsed = validateSchema(schemaText);
    if (!parsed) return;

    setIsSaving(true);
    try {
      const newSchema = await saveSchema({
        promptType,
        schema: parsed,
        name: schemaName.trim() || undefined,
        description: schemaDescription.trim() || `Custom ${PROMPT_TYPE_LABELS[promptType]} schema`,
      });
      if (onSave) {
        onSave(newSchema);
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save schema';
      setValidationError(message);
    } finally {
      setIsSaving(false);
    }
  }, [schemaText, schemaName, schemaDescription, validateSchema, saveSchema, promptType, onSave, onClose]);

  // Browse: select schema → go to edit
  const handleSelectSchema = useCallback((schema: SchemaDefinition) => {
    setSelectedSchema(schema);
    setActiveTab('edit');
  }, []);

  // Browse: delete schema
  const handleDeleteSchema = useCallback(async (id: string) => {
    try {
      await deleteSchema(id);
      if (selectedSchema?.id === id) {
        setSelectedSchema(null);
      }
    } catch {
      // Error handled by store
    }
  }, [deleteSchema, selectedSchema]);

  // Browse: inline rename
  const handleStartRename = useCallback((schema: SchemaDefinition) => {
    setRenamingId(schema.id);
    setRenameValue(schema.name);
  }, []);

  const handleFinishRename = useCallback(async (schema: SchemaDefinition) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== schema.name) {
      await saveSchema({
        ...schema,
        name: trimmed,
      });
    }
    setRenamingId(null);
  }, [renameValue, saveSchema]);

  // Generate
  const handleGenerate = useCallback(async () => {
    if (!userIdea.trim()) {
      setGenerateError('Please describe the output structure you need');
      return;
    }
    if (!llm.apiKey) {
      setGenerateError('Please configure your API key in Settings first');
      return;
    }
    if (!generateModel) {
      setGenerateError('Please select a model');
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedSchema(null);

    try {
      const provider = new GeminiProvider(llm.apiKey, generateModel);
      const metaPrompt = SCHEMA_GENERATOR_SYSTEM_PROMPT
        .replace('{{promptType}}', promptType.toUpperCase())
        .replace('{{userIdea}}', userIdea);

      const response = await provider.generateContent(metaPrompt, {
        temperature: 0.7,
        maxOutputTokens: 4096,
      });

      if (response.text) {
        const jsonMatch = response.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No valid JSON schema found in response');
        }
        const schema = JSON.parse(jsonMatch[0]);
        if (schema.type !== 'object' || !schema.properties) {
          throw new Error('Generated schema must be an object with properties');
        }
        setGeneratedSchema(schema);
      } else {
        setGenerateError('No response generated. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate schema';
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [userIdea, llm.apiKey, generateModel, promptType]);

  const handleUseGenerated = useCallback(() => {
    if (generatedSchema) {
      setSchemaText(JSON.stringify(generatedSchema, null, 2));
      setSchemaName('');
      setSchemaDescription('');
      setActiveTab('edit');
      setSelectedSchema(null);
      setGeneratedSchema(null);
      setUserIdea('');
    }
  }, [generatedSchema]);

  const handleClose = useCallback(() => {
    if (!isGenerating && !isSaving) {
      onClose();
    }
  }, [isGenerating, isSaving, onClose]);

  const tabs: { id: OverlayTab; label: string; icon: React.ReactNode }[] = [
    { id: 'browse', label: 'Browse', icon: <FileJson className="h-4 w-4" /> },
    { id: 'edit', label: 'Free Flow', icon: <ChevronRight className="h-4 w-4" /> },
    { id: 'generate', label: 'Generate', icon: <Sparkles className="h-4 w-4" /> },
  ];

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      {/* Right slide-in panel */}
      <div className="fixed inset-y-0 right-0 z-[101] w-[60vw] max-w-[900px] bg-[var(--bg-primary)] shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">
              {PROMPT_TYPE_LABELS[promptType]} Schema
            </h2>
            <button
              onClick={handleClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tab Bar */}
          <div className="shrink-0 flex gap-1 border-b border-[var(--border-subtle)] px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
                  activeTab === tab.id
                    ? 'border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* Browse Tab */}
            {activeTab === 'browse' && (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Select an existing schema to view or edit, or create a new one.
                </p>
                {typeSchemas.length === 0 ? (
                  <EmptyState
                    icon={FileJson}
                    title="No schemas yet"
                    description="Use the Generate tab to create one with AI."
                    compact
                  />
                ) : (
                  <div className="space-y-0.5">
                    {typeSchemas.map((schema) => (
                      <div
                        key={schema.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md transition-colors group cursor-pointer',
                          selectedSchema?.id === schema.id
                            ? 'bg-[var(--color-brand-accent)]/10 ring-1 ring-[var(--color-brand-primary)]'
                            : 'hover:bg-[var(--bg-secondary)]',
                        )}
                      >
                        <button
                          onClick={() => handleSelectSchema(schema)}
                          className="flex-1 flex items-center gap-3 text-left min-w-0"
                        >
                          <FileJson className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                          <div className="flex-1 min-w-0">
                            {renamingId === schema.id ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => handleFinishRename(schema)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleFinishRename(schema);
                                  if (e.key === 'Escape') setRenamingId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full h-7 rounded border border-[var(--border-focus)] bg-[var(--bg-primary)] px-2 text-[13px] text-[var(--text-primary)] focus:outline-none"
                              />
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] text-[var(--text-primary)] truncate">
                                    {schema.name}
                                  </span>
                                  {schema.isDefault && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                      built-in
                                    </span>
                                  )}
                                </div>
                                {schema.description && (
                                  <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                    {schema.description}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                        </button>

                        {/* Edit/Delete actions */}
                        {!schema.isDefault && renamingId !== schema.id && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRename(schema);
                              }}
                              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              title="Rename"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSchema(schema.id);
                              }}
                              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--color-error)]"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Edit / Free Flow Tab */}
            {activeTab === 'edit' && (
              <div className="h-full flex flex-col gap-3">
                {selectedSchema && (
                  <div className="flex items-center gap-2 text-[13px] shrink-0">
                    <span className="text-[var(--text-secondary)]">Editing:</span>
                    <span className="font-medium text-[var(--text-primary)]">{selectedSchema.name}</span>
                    {selectedSchema.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                        built-in (changes save as new version)
                      </span>
                    )}
                  </div>
                )}

                {/* Schema name + description for new schemas */}
                {!selectedSchema && (
                  <div className="flex gap-2 shrink-0">
                    <input
                      type="text"
                      value={schemaName}
                      onChange={(e) => setSchemaName(e.target.value)}
                      placeholder="Schema name..."
                      className="flex-1 h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={schemaDescription}
                      onChange={(e) => setSchemaDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="flex-1 h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none"
                    />
                  </div>
                )}

                <textarea
                  value={schemaText}
                  onChange={(e) => setSchemaText(e.target.value)}
                  onBlur={() => schemaText.trim() && validateSchema(schemaText)}
                  placeholder={`{\n  "type": "object",\n  "properties": {\n    ...\n  },\n  "required": [...]\n}`}
                  className="flex-1 min-h-[200px] w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
                />

                {/* Validation feedback inline */}
                {validationError && (
                  <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-error)] shrink-0">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}
                {saveSuccess && (
                  <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-success)] shrink-0">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span>Schema saved to library</span>
                  </div>
                )}
              </div>
            )}

            {/* Generate Tab */}
            {activeTab === 'generate' && (
              <div className="h-full flex flex-col gap-4">
                {/* Model selector */}
                <div className="shrink-0">
                  <ModelSelector
                    apiKey={llm.apiKey}
                    selectedModel={generateModel}
                    onChange={setGenerateModel}
                  />
                </div>

                <p className="text-[13px] text-[var(--text-secondary)] shrink-0">
                  Describe the output structure you need, and AI will generate a JSON Schema.
                </p>

                {generateError && (
                  <div className="flex items-center gap-2 rounded-md bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-3 text-[13px] text-[var(--color-error)] shrink-0">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{generateError}</span>
                  </div>
                )}

                {!generatedSchema ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <label className="text-[13px] font-medium text-[var(--text-primary)] shrink-0">
                      Describe Output Structure
                    </label>
                    <textarea
                      value={userIdea}
                      onChange={(e) => setUserIdea(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !isGenerating) {
                          e.preventDefault();
                          handleGenerate();
                        }
                      }}
                      placeholder={PROMPT_TYPE_PLACEHOLDERS[promptType]}
                      disabled={isGenerating}
                      className="flex-1 min-h-[120px] w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none disabled:opacity-50"
                    />
                    <p className="text-[11px] text-[var(--text-muted)] shrink-0">
                      Press Enter to generate
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-3">
                    <label className="text-[13px] font-medium text-[var(--text-primary)] shrink-0">
                      Generated Schema Preview
                    </label>
                    <div className="flex-1 min-h-[200px] overflow-auto rounded-md border border-[var(--border-default)]">
                      <JsonViewer data={generatedSchema} initialExpanded={false} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer — all actions consolidated here */}
          <div className="shrink-0 flex items-center justify-between px-6 py-3 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSaving || isGenerating}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {/* Browse tab: Create Blank + Use Selected */}
              {activeTab === 'browse' && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelectedSchema(null);
                      setSchemaText('{\n  "type": "object",\n  "properties": {\n    \n  },\n  "required": []\n}');
                      setSchemaName('');
                      setSchemaDescription('');
                      setActiveTab('edit');
                    }}
                    className="gap-1.5"
                  >
                    <FileJson className="h-3.5 w-3.5" />
                    New Blank
                  </Button>
                  {selectedSchema && onSave && (
                    <Button
                      size="sm"
                      onClick={handleUseSchema}
                      className="gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Use Selected
                    </Button>
                  )}
                </>
              )}

              {/* Edit tab: Save to Library + Save & Use */}
              {activeTab === 'edit' && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSaveAsNew}
                    disabled={!hasChanges || !!validationError || isSaving}
                    isLoading={isSaving}
                    className="gap-1.5"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save to Library
                  </Button>
                  {onSave && (
                    <Button
                      size="sm"
                      onClick={handleSaveAndUse}
                      isLoading={isSaving}
                      disabled={!!validationError || !schemaText.trim() || isSaving}
                      className="gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save &amp; Use
                    </Button>
                  )}
                </>
              )}

              {/* Generate tab: Generate / Discard+Regenerate+Use */}
              {activeTab === 'generate' && !generatedSchema && (
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  isLoading={isGenerating}
                  disabled={!userIdea.trim() || isGenerating || !generateModel}
                  className="gap-1.5"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {isGenerating ? 'Generating…' : 'Generate Schema'}
                </Button>
              )}
              {activeTab === 'generate' && generatedSchema && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setGeneratedSchema(null)}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                    Discard
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setGeneratedSchema(null);
                      handleGenerate();
                    }}
                    className="gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleUseGenerated}
                    className="gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Use This Schema
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
