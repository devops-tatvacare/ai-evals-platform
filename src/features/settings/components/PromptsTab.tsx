import { useState, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, Check, FileText, ChevronDown, ChevronRight, Eye, Pencil } from 'lucide-react';
import { Card, Button, Modal } from '@/components/ui';
import { usePromptsStore, useSettingsStore } from '@/stores';
import { promptsRepository } from '@/services/storage';
import { PromptModal } from './PromptModal';
import { DeletePromptModal } from './DeletePromptModal';
import type { PromptDefinition } from '@/types';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

const PROMPT_TYPES: PromptType[] = ['transcription', 'evaluation', 'extraction'];

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  transcription: 'Transcription Prompts',
  evaluation: 'Evaluation Prompts',
  extraction: 'Extraction Prompts',
};

export function PromptsTab() {
  const { prompts, loadPrompts, deletePrompt } = usePromptsStore();
  const { llm, updateLLMSettings } = useSettingsStore();
  
  // Unified modal state
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [promptModalType, setPromptModalType] = useState<PromptType>('transcription');
  const [promptModalInitial, setPromptModalInitial] = useState<PromptDefinition | null>(null);
  
  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<PromptDefinition | null>(null);
  const [deleteDependencies, setDeleteDependencies] = useState<{ count: number; listings: string[] }>({ count: 0, listings: [] });
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Collapsible section state - collapsed by default
  const [collapsedSections, setCollapsedSections] = useState<Record<PromptType, boolean>>({
    transcription: true,
    evaluation: true,
    extraction: true,
  });
  
  // Expanded prompt rows for inline preview
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  
  // Full view modal state
  const [viewingPrompt, setViewingPrompt] = useState<PromptDefinition | null>(null);

  // Load prompts on mount
  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  // Group prompts by type
  const promptsByType = useMemo(() => {
    const grouped: Record<PromptType, PromptDefinition[]> = {
      transcription: [],
      evaluation: [],
      extraction: [],
    };
    prompts.forEach((prompt) => {
      if (prompt.promptType in grouped) {
        grouped[prompt.promptType as PromptType].push(prompt);
      }
    });
    return grouped;
  }, [prompts]);

  // Get default prompts - stored as IDs now
  const getDefaultPromptId = useCallback((type: PromptType): string | null => {
    return llm.defaultPrompts?.[type] || null;
  }, [llm.defaultPrompts]);

  const handleSetDefault = useCallback((type: PromptType, promptId: string) => {
    const currentDefaults = llm.defaultPrompts || {
      transcription: null,
      evaluation: null,
      extraction: null,
    };
    updateLLMSettings({
      defaultPrompts: {
        ...currentDefaults,
        [type]: promptId,
      },
    });
  }, [llm.defaultPrompts, updateLLMSettings]);

  const handleDeleteClick = useCallback(async (prompt: PromptDefinition) => {
    const deps = await promptsRepository.checkDependencies(prompt.id);
    setPromptToDelete(prompt);
    setDeleteDependencies(deps);
    setShowDeleteModal(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!promptToDelete) return;
    
    setIsDeleting(true);
    try {
      await deletePrompt(promptToDelete.id);
      
      // Clear default if this was the default
      const type = promptToDelete.promptType as PromptType;
      if (getDefaultPromptId(type) === promptToDelete.id) {
        handleSetDefault(type, '');
      }
      
      setShowDeleteModal(false);
      setPromptToDelete(null);
    } catch (err) {
      console.error('Failed to delete prompt:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [promptToDelete, deletePrompt, getDefaultPromptId, handleSetDefault]);

  const handleCreateNew = useCallback((type: PromptType) => {
    setPromptModalType(type);
    setPromptModalInitial(null);
    setShowPromptModal(true);
  }, []);

  const handleEditPrompt = useCallback((prompt: PromptDefinition) => {
    setPromptModalType(prompt.promptType as PromptType);
    setPromptModalInitial(prompt);
    setShowPromptModal(true);
  }, []);

  const toggleSection = useCallback((type: PromptType) => {
    setCollapsedSections(prev => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const togglePromptExpand = useCallback((promptId: string) => {
    setExpandedPrompts(prev => {
      const next = new Set(prev);
      if (next.has(promptId)) {
        next.delete(promptId);
      } else {
        next.add(promptId);
      }
      return next;
    });
  }, []);

  const handleViewPrompt = useCallback((prompt: PromptDefinition) => {
    setViewingPrompt(prompt);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--text-secondary)]">
        Manage prompts for AI operations. Prompts define how the LLM processes audio and generates evaluations.
      </p>

      {PROMPT_TYPES.map((type) => {
        const typePrompts = promptsByType[type];
        const isCollapsed = collapsedSections[type];
        const defaultPromptId = getDefaultPromptId(type);
        const activePrompt = typePrompts.find(p => p.id === defaultPromptId);
        
        return (
          <Card key={type} className="p-0" hoverable={false}>
            {/* Collapsible Section Header */}
            <button
              onClick={() => toggleSection(type)}
              className="w-full px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50 flex items-center justify-between hover:bg-[var(--bg-secondary)]/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                )}
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {PROMPT_TYPE_LABELS[type]}
                </h3>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                  {typePrompts.length}
                </span>
              </div>
              {isCollapsed && activePrompt && (
                <span className="text-[11px] text-[var(--text-secondary)]">
                  Active: {activePrompt.name}
                </span>
              )}
            </button>
            
            {/* Collapsible Content */}
            {!isCollapsed && (
              <>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {typePrompts.length === 0 ? (
                    <div className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
                      No prompts yet. Create one to get started.
                    </div>
                  ) : (
                    typePrompts.map((prompt) => {
                      const isDefault = defaultPromptId === prompt.id;
                      const isExpanded = expandedPrompts.has(prompt.id);
                      
                      return (
                        <div key={prompt.id}>
                          {/* Prompt Row */}
                          <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)]/30">
                            {/* Expand toggle */}
                            <button
                              onClick={() => togglePromptExpand(prompt.id)}
                              className="shrink-0 p-0.5 rounded hover:bg-[var(--interactive-secondary)]"
                              title={isExpanded ? 'Collapse prompt' : 'Expand prompt'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                              )}
                            </button>
                            
                            <FileText className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] text-[var(--text-primary)] truncate">
                                  {prompt.name}
                                </span>
                                {prompt.isDefault && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                                    built-in
                                  </span>
                                )}
                                {isDefault && (
                                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-success)]/10 text-[var(--color-success)]">
                                    <Check className="h-3 w-3" />
                                    active
                                  </span>
                                )}
                              </div>
                              {prompt.description && (
                                <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                  {prompt.description}
                                </p>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-1 shrink-0">
                              {/* View full prompt button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewPrompt(prompt)}
                                className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                title="View full prompt"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              
                              {/* Edit prompt button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditPrompt(prompt)}
                                className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                title="Edit prompt"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              
                              {!isDefault && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSetDefault(type, prompt.id)}
                                  className="h-7 text-[11px]"
                                >
                                  Set Active
                                </Button>
                              )}
                              {!prompt.isDefault && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteClick(prompt)}
                                  className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--color-error)]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {/* Inline Prompt Preview */}
                          {isExpanded && (
                            <div className="px-4 pb-3 pt-0 ml-9">
                              <div className="max-h-64 overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                                <pre className="text-[11px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                                  {prompt.prompt}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCreateNew(type)}
                    className="h-8 text-[12px] gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create New Prompt
                  </Button>
                </div>
              </>
            )}
          </Card>
        );
      })}

      {/* View Prompt Modal (Full View) */}
      <Modal
        isOpen={!!viewingPrompt}
        onClose={() => setViewingPrompt(null)}
        title={viewingPrompt?.name || 'Prompt'}
        className="max-w-3xl max-h-[80vh]"
      >
        {viewingPrompt && (
          <div className="space-y-3">
            {viewingPrompt.description && (
              <p className="text-[13px] text-[var(--text-secondary)]">
                {viewingPrompt.description}
              </p>
            )}
            <div className="max-h-[60vh] overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <pre className="text-[12px] font-mono text-[var(--text-primary)] whitespace-pre-wrap">
                {viewingPrompt.prompt}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* Unified Prompt Modal (Browse/Edit/Generate) */}
      <PromptModal
        isOpen={showPromptModal}
        onClose={() => {
          setShowPromptModal(false);
          loadPrompts(); // Refresh after potential changes
        }}
        promptType={promptModalType}
        initialPrompt={promptModalInitial}
      />

      {/* Delete Confirmation Modal */}
      <DeletePromptModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        prompt={promptToDelete}
        dependencies={deleteDependencies}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
