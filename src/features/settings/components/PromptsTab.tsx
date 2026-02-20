import { useState, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, Check, FileText, ChevronDown, ChevronRight, Eye, Pencil, CircleCheck } from 'lucide-react';
import { Card, Button, EmptyState } from '@/components/ui';
import { useCurrentPrompts, useCurrentAppId } from '@/hooks';
import { useLLMSettingsStore } from '@/stores';
import { usePromptsStore } from '@/stores/promptsStore';
import { promptsRepository } from '@/services/storage';
import { PromptCreateOverlay } from './PromptCreateOverlay';
import { ReadOnlyViewOverlay } from './ReadOnlyViewOverlay';
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
  const appId = useCurrentAppId();
  const prompts = useCurrentPrompts();
  const deletePromptAction = usePromptsStore((state) => state.deletePrompt);
  const loadPromptsAction = usePromptsStore((state) => state.loadPrompts);
  const activePromptIds = useLLMSettingsStore((state) => state.activePromptIds);
  const setActivePromptId = useLLMSettingsStore((state) => state.setActivePromptId);
  const save = useLLMSettingsStore((state) => state.save);
  
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
  
  // Loading state for Set Active button
  const [activatingPrompt, setActivatingPrompt] = useState<string | null>(null);

  // Load prompts on mount ONLY
  useEffect(() => {
    loadPromptsAction(appId);
  }, [appId, loadPromptsAction]);

  // Auto-activate built-in defaults if no prompts are active yet
  useEffect(() => {
    if (prompts.length === 0) return;

    // Check if any defaults are missing
    const needsInitialization = (
      activePromptIds.transcription === null ||
      activePromptIds.evaluation === null ||
      activePromptIds.extraction === null
    );

    if (!needsInitialization) return;

    // Find built-in defaults and activate them
    const builtInDefaults: Record<PromptType, PromptDefinition | undefined> = {
      transcription: prompts.find(p => p.promptType === 'transcription' && p.isDefault),
      evaluation: prompts.find(p => p.promptType === 'evaluation' && p.isDefault),
      extraction: prompts.find(p => p.promptType === 'extraction' && p.isDefault),
    };

    let hasChanges = false;

    (['transcription', 'evaluation', 'extraction'] as PromptType[]).forEach(type => {
      if (!activePromptIds[type] && builtInDefaults[type]) {
        setActivePromptId(type, builtInDefaults[type]!.id);
        hasChanges = true;
      }
    });

    if (hasChanges) {
      save().catch(err => console.error('[PromptsTab] Failed to save auto-activated defaults:', err));
    }
  }, [prompts, activePromptIds, setActivePromptId, save]);

  // Group prompts by type, then sub-group by sourceType
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

  // Sub-group by sourceType for display
  const getFlowGroups = useCallback((typePrompts: PromptDefinition[]) => {
    const upload = typePrompts.filter(p => p.sourceType === 'upload');
    const api = typePrompts.filter(p => p.sourceType === 'api');
    const untagged = typePrompts.filter(p => !p.sourceType);
    const groups: { label: string; badge: string; prompts: PromptDefinition[] }[] = [];
    if (upload.length > 0) groups.push({ label: 'Upload Flow', badge: 'Upload', prompts: upload });
    if (api.length > 0) groups.push({ label: 'API Flow', badge: 'API', prompts: api });
    if (untagged.length > 0) groups.push({ label: 'Custom (Any Flow)', badge: 'Custom', prompts: untagged });
    return groups;
  }, []);

  const getDefaultPromptId = useCallback((type: PromptType): string | null => {
    return activePromptIds[type] || null;
  }, [activePromptIds]);

  const handleSetDefault = useCallback(async (type: PromptType, promptId: string) => {
    setActivatingPrompt(promptId);

    // Add small delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 300));

    setActivePromptId(type, promptId);
    await save();

    setActivatingPrompt(null);
   }, [setActivePromptId, save]);

  const handleDeleteClick = useCallback(async (prompt: PromptDefinition) => {
    const deps = await promptsRepository.checkDependencies(appId, prompt.id);
    setPromptToDelete(prompt);
    setDeleteDependencies(deps);
    setShowDeleteModal(true);
  }, [appId]);

  const handleConfirmDelete = useCallback(async () => {
    if (!promptToDelete) return;
    
    setIsDeleting(true);
    try {
      await deletePromptAction(appId, promptToDelete.id);
      
      // Clear default if this was the default
      const type = promptToDelete.promptType as PromptType;
      if (getDefaultPromptId(type) === promptToDelete.id) {
        setActivePromptId(type, null);
        await save();
      }
      
      setShowDeleteModal(false);
      setPromptToDelete(null);
    } catch (err) {
      console.error('Failed to delete prompt:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [promptToDelete, deletePromptAction, appId, getDefaultPromptId, setActivePromptId, save]);

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
        const activeId = getDefaultPromptId(type);
        const activePrompt = typePrompts.find(p => p.id === activeId);
        
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
                <span className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)] font-medium">
                  <Check className="h-3 w-3" />
                  {activePrompt.name}
                </span>
              )}
            </button>
            
            {/* Collapsible Content */}
            {!isCollapsed && (
              <>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {typePrompts.length === 0 ? (
                    <div className="px-4 py-4">
                      <EmptyState
                        icon={FileText}
                        title="No prompts yet"
                        description="Create one to get started."
                        compact
                      />
                    </div>
                  ) : (
                    getFlowGroups(typePrompts).map((group) => (
                      <div key={group.badge}>
                        {/* Flow Group Header */}
                        <div className="px-4 py-2 bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-subtle)]">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                            group.badge === 'API'
                              ? 'text-[var(--color-info)]'
                              : group.badge === 'Upload'
                                ? 'text-[var(--text-brand)]'
                                : 'text-[var(--text-muted)]'
                          }`}>
                            {group.label}
                          </span>
                        </div>
                        {group.prompts.map((prompt) => {
                          const isDefault = activeId === prompt.id;
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
                                    {prompt.sourceType && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                        prompt.sourceType === 'api'
                                          ? 'bg-[var(--color-info)]/10 text-[var(--color-info)]'
                                          : 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]'
                                      }`}>
                                        {prompt.sourceType === 'api' ? 'API' : 'Upload'}
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
                                
                                <div className="flex items-center gap-1 shrink-0 justify-end">
                                  {/* View */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleViewPrompt(prompt)}
                                    className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    title="View full prompt"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  
                                  {/* Edit (custom prompts only — defaults are read-only) */}
                                  {!prompt.isDefault && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleEditPrompt(prompt)}
                                      className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                      title="Edit prompt"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                  
                                  {/* Set Active */}
                                  <div className="w-7 flex justify-center">
                                    {!isDefault && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleSetDefault(type, prompt.id)}
                                        disabled={activatingPrompt === prompt.id}
                                        className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--color-success)]"
                                        title="Set as active prompt"
                                      >
                                        <CircleCheck className={`h-3.5 w-3.5 ${activatingPrompt === prompt.id ? 'animate-pulse' : ''}`} />
                                      </Button>
                                    )}
                                  </div>
                                  
                                  {/* Delete */}
                                  <div className="w-7 flex justify-center">
                                    {!prompt.isDefault && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteClick(prompt)}
                                        className="h-7 w-7 p-0 text-[var(--text-muted)] hover:text-[var(--color-error)]"
                                        title="Delete prompt"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </div>
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
                        })}
                      </div>
                    ))
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

      {/* View Prompt Overlay (Read-Only) */}
      <ReadOnlyViewOverlay
        isOpen={!!viewingPrompt}
        onClose={() => setViewingPrompt(null)}
        title={viewingPrompt?.name || 'Prompt'}
        description={viewingPrompt?.description}
        textContent={viewingPrompt?.prompt}
      />

      {/* Unified Prompt Overlay (Browse/Edit/Generate) */}
      <PromptCreateOverlay
        isOpen={showPromptModal}
        onClose={() => {
          setShowPromptModal(false);
          loadPromptsAction(appId);
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
