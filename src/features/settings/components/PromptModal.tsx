import { useState, useCallback, useMemo, useEffect } from 'react';
import { Save, Wand2, AlertCircle, Check, FileText, ChevronRight } from 'lucide-react';
import { Modal, Button, Input, EmptyState } from '@/components/ui';
import { useCurrentPrompts, useCurrentPromptsActions } from '@/hooks';
import { PromptGeneratorModal } from './PromptGeneratorModal';
import type { PromptDefinition } from '@/types';
import { cn } from '@/utils';

type PromptType = 'transcription' | 'evaluation' | 'extraction';
type TabType = 'browse' | 'edit' | 'generate';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  promptType: PromptType;
  initialPrompt?: PromptDefinition | null;
}

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  transcription: 'Transcription',
  evaluation: 'Evaluation',
  extraction: 'Extraction',
};

export function PromptModal({
  isOpen,
  onClose,
  promptType,
  initialPrompt,
}: PromptModalProps) {
  const prompts = useCurrentPrompts();
  const { loadPrompts, savePrompt } = useCurrentPromptsActions();
  
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  
  // Browse tab state
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDefinition | null>(initialPrompt || null);
  
  // Edit tab state
  const [promptText, setPromptText] = useState('');
  const [promptDescription, setPromptDescription] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Generate tab state
  const [showGenerator, setShowGenerator] = useState(false);

  // Get prompts for this type
  const typePrompts = useMemo(
    () => prompts.filter((p) => p.promptType === promptType),
    [prompts, promptType]
  );

  // Load prompts on mount
  useEffect(() => {
    if (isOpen) {
      loadPrompts();
    }
  }, [isOpen, loadPrompts]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialPrompt ? 'edit' : 'browse');
      setSelectedPrompt(initialPrompt || null);
      setPromptText(initialPrompt?.prompt || '');
      setPromptDescription(initialPrompt?.description || '');
      setValidationError(null);
      setSaveSuccess(false);
    }
  }, [isOpen, initialPrompt]);

  // Update prompt text when selected prompt changes
  useEffect(() => {
    if (selectedPrompt) {
      setPromptText(selectedPrompt.prompt);
      setPromptDescription(selectedPrompt.description || '');
      setValidationError(null);
    }
  }, [selectedPrompt]);

  // Check if content has changed from selected prompt
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
      await savePrompt({
        promptType,
        prompt: promptText,
        description: promptDescription || undefined,
      });
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Failed to save prompt:', err);
      setValidationError('Failed to save prompt');
    } finally {
      setIsSaving(false);
    }
  }, [promptText, promptDescription, promptType, savePrompt, validatePrompt, onClose]);

  const handleEditSelected = useCallback((prompt: PromptDefinition) => {
    setSelectedPrompt(prompt);
    setActiveTab('edit');
  }, []);

  const handleGeneratedPrompt = useCallback((generatedText: string) => {
    setPromptText(generatedText);
    setActiveTab('edit');
  }, []);

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'browse', label: 'Browse', icon: <FileText className="h-3.5 w-3.5" /> },
    { id: 'edit', label: 'Edit', icon: <ChevronRight className="h-3.5 w-3.5" /> },
    { id: 'generate', label: 'Generate', icon: <Wand2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`${PROMPT_TYPE_LABELS[promptType]} Prompt`}
        className="max-w-4xl max-h-[85vh]"
      >
        <div className="flex flex-col h-full">
          {/* Tabs */}
          <div className="flex border-b border-[var(--border-subtle)] mb-4">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-[13px] font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'browse' && (
              <div className="space-y-3">
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Select an existing prompt to view or edit:
                </p>
                {typePrompts.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No prompts yet"
                    description="Create one in the Edit tab."
                    compact
                  />
                ) : (
                  <div className="space-y-2">
                    {typePrompts.map((prompt) => (
                      <div
                        key={prompt.id}
                        className={cn(
                          'p-3 rounded-[var(--radius-default)] border cursor-pointer transition-colors',
                          selectedPrompt?.id === prompt.id
                            ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/5'
                            : 'border-[var(--border-default)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-secondary)]'
                        )}
                        onClick={() => handleEditSelected(prompt)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                                {prompt.name}
                              </span>
                              {prompt.isDefault && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                  built-in
                                </span>
                              )}
                            </div>
                            {prompt.description && (
                              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                                {prompt.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'edit' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                    Description (optional)
                  </label>
                  <Input
                    value={promptDescription}
                    onChange={(e) => setPromptDescription(e.target.value)}
                    placeholder="Brief description of this prompt"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
                    Prompt Text
                  </label>
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={16}
                    className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 font-mono text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-y"
                    placeholder="Enter your prompt here..."
                  />
                </div>

                {validationError && (
                  <div className="flex items-center gap-2 text-[13px] text-[var(--color-error)]">
                    <AlertCircle className="h-4 w-4" />
                    {validationError}
                  </div>
                )}

                {saveSuccess && (
                  <div className="flex items-center gap-2 text-[13px] text-[var(--color-success)]">
                    <Check className="h-4 w-4" />
                    Prompt saved successfully!
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={onClose}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveAsNew}
                    isLoading={isSaving}
                    disabled={!hasChanges || !!validationError}
                  >
                    <Save className="h-4 w-4 mr-1.5" />
                    Save as New Version
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'generate' && (
              <div className="space-y-4">
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Use AI to generate a professional prompt based on your requirements.
                </p>
                <Button
                  onClick={() => setShowGenerator(true)}
                  className="w-full"
                >
                  <Wand2 className="h-4 w-4 mr-2" />
                  Open Prompt Generator
                </Button>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Prompt Generator Modal */}
      <PromptGeneratorModal
        isOpen={showGenerator}
        onClose={() => setShowGenerator(false)}
        promptType={promptType}
        onGenerated={handleGeneratedPrompt}
      />
    </>
  );
}
