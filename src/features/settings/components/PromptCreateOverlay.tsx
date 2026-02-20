import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  X, Save, Sparkles, AlertCircle, Check, FileText,
  ChevronRight, RefreshCw, Wand2, Pencil, Trash2,
} from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { useCurrentPrompts, useCurrentPromptsActions } from '@/hooks';
import { useLLMSettingsStore } from '@/stores';
import { createLLMPipelineWithModel } from '@/services/llm';
import { PROMPT_GENERATOR_SYSTEM_PROMPT } from '@/constants';
import type { PromptDefinition, ListingSourceType } from '@/types';
import { cn } from '@/utils';

type PromptType = 'transcription' | 'evaluation' | 'extraction';
type OverlayTab = 'browse' | 'edit' | 'generate';

interface PromptCreateOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: PromptType;
  initialPrompt?: PromptDefinition | null;
  onSave?: (prompt: PromptDefinition) => void;
  sourceType?: ListingSourceType;
}

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  transcription: 'Transcription',
  evaluation: 'Evaluation',
  extraction: 'Extraction',
};

const PROMPT_TYPE_PLACEHOLDERS: Record<PromptType, string> = {
  transcription: 'e.g., "Focus on cardiology terms and abbreviations, identify doctor vs nurse vs patient"',
  evaluation: 'e.g., "Be strict about medication dosages and patient identifiers, flag numerical discrepancies"',
  extraction: 'e.g., "Extract patient demographics, medications, diagnoses, and follow-up instructions"',
};

export function PromptCreateOverlay({
  isOpen,
  onClose,
  promptType,
  initialPrompt,
  onSave,
  sourceType,
}: PromptCreateOverlayProps) {
  const prompts = useCurrentPrompts();
  const { loadPrompts, savePrompt, deletePrompt } = useCurrentPromptsActions();
  const llm = useLLMSettingsStore();

  // Tab state
  const [activeTab, setActiveTab] = useState<OverlayTab>('browse');

  // Browse tab state
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDefinition | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Edit tab state
  const [promptText, setPromptText] = useState('');
  const [promptDescription, setPromptDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Generate tab state
  const [userIdea, setUserIdea] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [generateModel, setGenerateModel] = useState(llm.selectedModel || '');

  const typePrompts = useMemo(
    () => prompts.filter((p) => p.promptType === promptType),
    [prompts, promptType],
  );

  // Load prompts on mount
  useEffect(() => {
    if (isOpen) {
      loadPrompts();
    }
  }, [isOpen, loadPrompts]);

  // Sync generate model with settings when overlay opens
  useEffect(() => {
    if (isOpen) {
      setGenerateModel(llm.selectedModel || '');
    }
  }, [isOpen, llm.selectedModel]);

  // Reset state when overlay opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialPrompt ? 'edit' : 'browse');
      setSelectedPrompt(initialPrompt || null);
      setPromptText(initialPrompt?.prompt || '');
      setPromptDescription(initialPrompt?.description || '');
      setValidationError(null);
      setSaveSuccess(false);
      setUserIdea('');
      setGenerateError(null);
      setGeneratedPrompt(null);
      setRenamingId(null);
    }
  }, [isOpen, initialPrompt]);

  // Update text when selected prompt changes
  useEffect(() => {
    if (selectedPrompt) {
      setPromptText(selectedPrompt.prompt);
      setPromptDescription(selectedPrompt.description || '');
      setValidationError(null);
    }
  }, [selectedPrompt]);

  const hasChanges = useMemo(() => {
    if (!selectedPrompt) return promptText.trim().length > 0;
    return (
      promptText !== selectedPrompt.prompt ||
      promptDescription !== (selectedPrompt.description || '')
    );
  }, [promptText, promptDescription, selectedPrompt]);

  const validatePrompt = useCallback((text: string): boolean => {
    if (!text.trim()) {
      setValidationError('Prompt cannot be empty');
      return false;
    }
    setValidationError(null);
    return true;
  }, []);

  const handleSaveAsNew = useCallback(async () => {
    if (!validatePrompt(promptText)) return;

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const taggedSourceType = sourceType === 'upload' || sourceType === 'api' ? sourceType : undefined;
      const newPrompt = await savePrompt({
        promptType,
        prompt: promptText,
        description: promptDescription.trim() || undefined,
        sourceType: taggedSourceType,
      });
      setSelectedPrompt(newPrompt);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save prompt';
      setValidationError(message);
    } finally {
      setIsSaving(false);
    }
  }, [promptText, promptDescription, validatePrompt, savePrompt, promptType, sourceType]);

  const handleUsePrompt = useCallback(() => {
    if (selectedPrompt && onSave) {
      onSave(selectedPrompt);
      onClose();
    }
  }, [selectedPrompt, onSave, onClose]);

  const handleSaveAndUse = useCallback(async () => {
    if (!validatePrompt(promptText)) return;

    setIsSaving(true);
    try {
      const taggedSourceType = sourceType === 'upload' || sourceType === 'api' ? sourceType : undefined;
      const newPrompt = await savePrompt({
        promptType,
        prompt: promptText,
        description: promptDescription.trim() || undefined,
        sourceType: taggedSourceType,
      });
      if (onSave) {
        onSave(newPrompt);
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save prompt';
      setValidationError(message);
    } finally {
      setIsSaving(false);
    }
  }, [promptText, promptDescription, validatePrompt, savePrompt, promptType, onSave, onClose, sourceType]);

  // Browse: select → edit
  const handleSelectPrompt = useCallback((prompt: PromptDefinition) => {
    setSelectedPrompt(prompt);
    setActiveTab('edit');
  }, []);

  // Browse: delete
  const handleDeletePrompt = useCallback(async (id: string) => {
    try {
      await deletePrompt(id);
      if (selectedPrompt?.id === id) {
        setSelectedPrompt(null);
      }
    } catch {
      // Error handled by store
    }
  }, [deletePrompt, selectedPrompt]);

  // Browse: inline rename
  const handleStartRename = useCallback((prompt: PromptDefinition) => {
    setRenamingId(prompt.id);
    setRenameValue(prompt.name);
  }, []);

  const handleFinishRename = useCallback(async (prompt: PromptDefinition) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== prompt.name) {
      await savePrompt({
        ...prompt,
        name: trimmed,
      });
    }
    setRenamingId(null);
  }, [renameValue, savePrompt]);

  // Generate
  const handleGenerate = useCallback(async () => {
    if (!userIdea.trim()) {
      setGenerateError('Please describe what you need the prompt to do');
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
    setGeneratedPrompt(null);

    try {
      const pipeline = createLLMPipelineWithModel(generateModel);
      const metaPrompt = PROMPT_GENERATOR_SYSTEM_PROMPT
        .replace('{{promptType}}', promptType.toUpperCase())
        .replace('{{userIdea}}', userIdea);

      const response = await pipeline.invoke({
        prompt: metaPrompt,
        context: {
          source: 'prompt-gen',
          sourceId: `prompt-${Date.now()}`,
        },
        output: {
          format: 'text',
        },
        config: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      });

      if (response.output.text) {
        setGeneratedPrompt(response.output.text.trim());
      } else {
        setGenerateError('No response generated. Please try again.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate prompt';
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [userIdea, llm.apiKey, generateModel, promptType]);

  const handleUseGenerated = useCallback(() => {
    if (generatedPrompt) {
      setPromptText(generatedPrompt);
      setPromptDescription('');
      setActiveTab('edit');
      setSelectedPrompt(null);
      setGeneratedPrompt(null);
      setUserIdea('');
    }
  }, [generatedPrompt]);

  const handleClose = useCallback(() => {
    if (!isGenerating && !isSaving) {
      onClose();
    }
  }, [isGenerating, isSaving, onClose]);

  const tabs: { id: OverlayTab; label: string; icon: React.ReactNode }[] = [
    { id: 'browse', label: 'Browse', icon: <FileText className="h-4 w-4" /> },
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
              {PROMPT_TYPE_LABELS[promptType]} Prompt
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
                    ? 'border-[var(--border-brand)] text-[var(--text-brand)]'
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
                  Select an existing prompt to view or edit, or create a new one.
                </p>
                {typePrompts.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No prompts yet"
                    description="Use the Generate tab to create one with AI."
                    compact
                  />
                ) : (
                  <div className="space-y-0.5">
                    {typePrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md transition-colors group cursor-pointer',
                          selectedPrompt?.id === prompt.id
                            ? 'bg-[var(--color-brand-accent)]/10 ring-1 ring-[var(--border-brand)]'
                            : 'hover:bg-[var(--bg-secondary)]',
                        )}
                      >
                        <button
                          onClick={() => handleSelectPrompt(prompt)}
                          className="flex-1 flex items-center gap-3 text-left min-w-0"
                        >
                          <FileText className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                          <div className="flex-1 min-w-0">
                            {renamingId === prompt.id ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => handleFinishRename(prompt)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleFinishRename(prompt);
                                  if (e.key === 'Escape') setRenamingId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full h-7 rounded border border-[var(--border-focus)] bg-[var(--bg-primary)] px-2 text-[13px] text-[var(--text-primary)] focus:outline-none"
                              />
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] text-[var(--text-primary)] truncate">
                                    {prompt.name}
                                  </span>
                                  {prompt.isDefault && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                      built-in
                                    </span>
                                  )}
                                </div>
                                {prompt.description && (
                                  <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                    {prompt.description}
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                        </button>

                        {/* Edit/Delete actions */}
                        {!prompt.isDefault && renamingId !== prompt.id && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRename(prompt);
                              }}
                              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              title="Rename"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePrompt(prompt.id);
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
                {selectedPrompt && (
                  <div className="flex items-center gap-2 text-[13px] shrink-0">
                    <span className="text-[var(--text-secondary)]">Editing:</span>
                    <span className="font-medium text-[var(--text-primary)]">{selectedPrompt.name}</span>
                    {selectedPrompt.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                        built-in (changes save as new version)
                      </span>
                    )}
                  </div>
                )}

                {/* Description for new prompts */}
                {!selectedPrompt && (
                  <input
                    type="text"
                    value={promptDescription}
                    onChange={(e) => setPromptDescription(e.target.value)}
                    placeholder="Description (optional)"
                    className="shrink-0 h-8 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none"
                  />
                )}

                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  onBlur={() => promptText.trim() && validatePrompt(promptText)}
                  placeholder="Enter your prompt here..."
                  className="flex-1 min-h-[200px] w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-[12px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none"
                />

                {validationError && (
                  <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-error)] shrink-0">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}
                {saveSuccess && (
                  <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-success)] shrink-0">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span>Prompt saved to library</span>
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
                    mode="api-key-only"
                  />
                </div>

                <p className="text-[13px] text-[var(--text-secondary)] shrink-0">
                  Describe your requirements, and AI will generate a production-ready prompt.
                </p>

                {generateError && (
                  <div className="flex items-center gap-2 rounded-md bg-[var(--color-error-light)] border border-[var(--color-error)]/30 p-3 text-[13px] text-[var(--color-error)] shrink-0">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{generateError}</span>
                  </div>
                )}

                {!generatedPrompt ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <label className="text-[13px] font-medium text-[var(--text-primary)] shrink-0">
                      Your Idea
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
                      Generated Prompt Preview
                    </label>
                    <div className="flex-1 min-h-[200px] overflow-auto rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                      <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                        {generatedPrompt}
                      </pre>
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
              {/* Browse tab: New Blank + Use Selected */}
              {activeTab === 'browse' && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSelectedPrompt(null);
                      setPromptText('');
                      setPromptDescription('');
                      setActiveTab('edit');
                    }}
                    className="gap-1.5"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    New Blank
                  </Button>
                  {selectedPrompt && onSave && (
                    <Button
                      size="sm"
                      onClick={handleUsePrompt}
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
                      disabled={!!validationError || !promptText.trim() || isSaving}
                      className="gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save &amp; Use
                    </Button>
                  )}
                </>
              )}

              {/* Generate tab */}
              {activeTab === 'generate' && !generatedPrompt && (
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  isLoading={isGenerating}
                  disabled={!userIdea.trim() || isGenerating || !generateModel}
                  className="gap-1.5"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {isGenerating ? 'Generating…' : 'Generate Prompt'}
                </Button>
              )}
              {activeTab === 'generate' && generatedPrompt && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setGeneratedPrompt(null)}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                    Discard
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setGeneratedPrompt(null);
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
                    Use This Prompt
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
