import { useState, useCallback, useMemo, useEffect } from 'react';
import { 
  Save, Sparkles, AlertCircle, Check, FileJson, 
  ChevronRight, RefreshCw, Wand2, X 
} from 'lucide-react';
import { Modal, Button, ModelBadge, EmptyState } from '@/components/ui';
import { useCurrentSchemas, useCurrentSchemasActions } from '@/hooks';
import { useLLMSettingsStore } from '@/stores';
import { GeminiProvider, discoverGeminiModels, type GeminiModel } from '@/services/llm';
import { SCHEMA_GENERATOR_SYSTEM_PROMPT } from '@/constants';
import { JsonViewer } from '@/features/structured-outputs/components/JsonViewer';
import type { SchemaDefinition } from '@/types';
import { cn } from '@/utils';

type PromptType = 'transcription' | 'evaluation' | 'extraction';
type TabType = 'browse' | 'edit' | 'generate';

interface SchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: PromptType;
  initialSchema?: SchemaDefinition | null;
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

export function SchemaModal({
  isOpen,
  onClose,
  promptType,
  initialSchema,
}: SchemaModalProps) {
  const schemas = useCurrentSchemas();
  const { loadSchemas, saveSchema } = useCurrentSchemasActions();
  const llm = useLLMSettingsStore();
  
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  
  // Browse tab state
  const [selectedSchema, setSelectedSchema] = useState<SchemaDefinition | null>(initialSchema || null);
  
  // Edit tab state
  const [schemaText, setSchemaText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Generate tab state
  const [userIdea, setUserIdea] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedSchema, setGeneratedSchema] = useState<Record<string, unknown> | null>(null);
  const [modelInfo, setModelInfo] = useState<GeminiModel | null>(null);

  // Get schemas for this type
  const typeSchemas = useMemo(
    () => schemas.filter((s) => s.promptType === promptType),
    [schemas, promptType]
  );

  // Load schemas and model info on mount
  useEffect(() => {
    if (isOpen) {
      loadSchemas();
      if (llm.apiKey && llm.selectedModel) {
        discoverGeminiModels(llm.apiKey)
          .then((models) => {
            const model = models.find((m) => m.name === llm.selectedModel);
            setModelInfo(model || null);
          })
          .catch(() => setModelInfo(null));
      }
    }
  }, [isOpen, loadSchemas, llm.apiKey, llm.selectedModel]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialSchema ? 'edit' : 'browse');
      setSelectedSchema(initialSchema || null);
      setSchemaText(initialSchema ? JSON.stringify(initialSchema.schema, null, 2) : '');
      setValidationError(null);
      setSaveSuccess(false);
      setUserIdea('');
      setGenerateError(null);
      setGeneratedSchema(null);
    }
  }, [isOpen, initialSchema]);

  // Update schema text when selected schema changes
  useEffect(() => {
    if (selectedSchema) {
      setSchemaText(JSON.stringify(selectedSchema.schema, null, 2));
      setValidationError(null);
    }
  }, [selectedSchema]);

  // Check if content has changed from selected schema
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
        description: `Custom ${PROMPT_TYPE_LABELS[promptType]} schema`,
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
  }, [schemaText, validateSchema, saveSchema, promptType]);

  const handleGenerate = useCallback(async () => {
    if (!userIdea.trim()) {
      setGenerateError('Please describe the output structure you need');
      return;
    }
    if (!llm.apiKey) {
      setGenerateError('Please configure your API key in Settings first');
      return;
    }

    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedSchema(null);

    try {
      const provider = new GeminiProvider(llm.apiKey, llm.selectedModel);
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
  }, [userIdea, llm.apiKey, llm.selectedModel, promptType]);

  const handleUseGenerated = useCallback(() => {
    if (generatedSchema) {
      setSchemaText(JSON.stringify(generatedSchema, null, 2));
      setActiveTab('edit');
      setGeneratedSchema(null);
      setUserIdea('');
    }
  }, [generatedSchema]);

  const handleSelectSchema = useCallback((schema: SchemaDefinition) => {
    setSelectedSchema(schema);
    setActiveTab('edit');
  }, []);

  const handleClose = useCallback(() => {
    if (!isGenerating && !isSaving) {
      onClose();
    }
  }, [isGenerating, isSaving, onClose]);

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'browse', label: 'Browse', icon: <FileJson className="h-4 w-4" /> },
    { id: 'edit', label: 'Edit', icon: <ChevronRight className="h-4 w-4" /> },
    { id: 'generate', label: 'Generate', icon: <Sparkles className="h-4 w-4" /> },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`${PROMPT_TYPE_LABELS[promptType]} Schema`}
      className="max-w-3xl max-h-[85vh]"
    >
      <div className="flex flex-col h-full">
        {/* Tab Bar */}
        <div className="flex gap-1 border-b border-[var(--border-subtle)] mb-4 -mx-6 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto min-h-0">
          {/* Browse Tab */}
          {activeTab === 'browse' && (
            <div className="space-y-2">
              <p className="text-[13px] text-[var(--text-secondary)] mb-3">
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
                <div className="space-y-1">
                  {typeSchemas.map((schema) => (
                    <button
                      key={schema.id}
                      onClick={() => handleSelectSchema(schema)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                        selectedSchema?.id === schema.id
                          ? 'bg-[var(--color-brand-accent)]/10 border border-[var(--color-brand-primary)]'
                          : 'hover:bg-[var(--bg-secondary)] border border-transparent'
                      )}
                    >
                      <FileJson className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
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
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {schema.description}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                    </button>
                  ))}
                </div>
              )}
              
              <div className="pt-4 border-t border-[var(--border-subtle)] mt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSelectedSchema(null);
                    setSchemaText('{\n  "type": "object",\n  "properties": {\n    \n  },\n  "required": []\n}');
                    setActiveTab('edit');
                  }}
                  className="gap-2"
                >
                  <FileJson className="h-4 w-4" />
                  Create Blank Schema
                </Button>
              </div>
            </div>
          )}

          {/* Edit Tab */}
          {activeTab === 'edit' && (
            <div className="space-y-3">
              {selectedSchema && (
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-[var(--text-secondary)]">Editing:</span>
                  <span className="font-medium text-[var(--text-primary)]">{selectedSchema.name}</span>
                  {selectedSchema.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                      built-in (changes save as new version)
                    </span>
                  )}
                </div>
              )}
              
              <textarea
                value={schemaText}
                onChange={(e) => setSchemaText(e.target.value)}
                onBlur={() => schemaText.trim() && validateSchema(schemaText)}
                rows={14}
                placeholder={`{\n  "type": "object",\n  "properties": {\n    ...\n  },\n  "required": [...]\n}`}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
              />

              <div className="flex items-center justify-between">
                <div className="flex-1">
                  {validationError && (
                    <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-error)]">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{validationError}</span>
                    </div>
                  )}
                  {saveSuccess && (
                    <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-success)]">
                      <Check className="h-3.5 w-3.5" />
                      <span>Schema saved as new version</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('generate')}
                    className="gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate with AI
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSaveAsNew}
                    disabled={!hasChanges || !!validationError || isSaving}
                    isLoading={isSaving}
                    className="gap-1.5"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save as New Version
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Generate Tab */}
          {activeTab === 'generate' && (
            <div className="space-y-4">
              {/* Model Badge */}
              <ModelBadge
                modelName={llm.selectedModel || 'No model selected'}
                displayName={modelInfo?.displayName}
                variant="full"
                isActive
              />

              <p className="text-[13px] text-[var(--text-secondary)]">
                Describe the output structure you need, and AI will generate a JSON Schema.
              </p>

              {generateError && (
                <div className="flex items-center gap-2 rounded-md bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-3 text-[13px] text-[var(--color-error)]">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{generateError}</span>
                </div>
              )}

              {!generatedSchema ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">
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
                      rows={4}
                      disabled={isGenerating}
                      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none disabled:opacity-50"
                    />
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                      Press Enter to generate
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onClick={handleGenerate}
                      isLoading={isGenerating}
                      disabled={!userIdea.trim() || isGenerating}
                      className="gap-2"
                    >
                      <Wand2 className="h-4 w-4" />
                      {isGenerating ? 'Generating...' : 'Generate Schema'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">
                      Generated Schema Preview
                    </label>
                    <div className="max-h-64 overflow-auto rounded-md border border-[var(--border-default)]">
                      <JsonViewer data={generatedSchema} initialExpanded={false} />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
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
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
