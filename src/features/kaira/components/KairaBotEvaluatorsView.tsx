/**
 * KairaBotEvaluatorsView — evaluators tab for kaira-bot.
 *
 * Same look/feel as the voice-rx EvaluatorsView but adapted for
 * kaira-bot app-level evaluators (no listing, uses chat sessions).
 */

import { useState, useEffect, useRef } from 'react';
import { Plus, ChevronDown, BarChart3 } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState } from '@/components/ui';
import { CreateEvaluatorOverlay } from '@/features/evals/components/CreateEvaluatorOverlay';
import { EvaluatorCard } from '@/features/evals/components/EvaluatorCard';
import { EvaluatorRegistryPicker } from '@/features/evals/components/EvaluatorRegistryPicker';
import { useEvaluatorsStore, useLLMSettingsStore } from '@/stores';
import { useTaskQueueStore } from '@/stores';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { chatSessionsRepository } from '@/services/api/chatApi';
import { notificationService } from '@/services/notifications';
import type { KairaChatSession, KairaChatMessage, EvaluatorDefinition, EvaluatorRun, EvaluatorContext } from '@/types';

interface KairaBotEvaluatorsViewProps {
  session: KairaChatSession | null;
  messages: KairaChatMessage[];
}

export function KairaBotEvaluatorsView({ session, messages: _messages }: KairaBotEvaluatorsViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showRegistryPicker, setShowRegistryPicker] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<string | null>(null);
  const [evaluatorRuns, setEvaluatorRuns] = useState<EvaluatorRun[]>(session?.evaluatorRuns || []);

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const {
    evaluators, isLoaded, currentAppId,
    loadAppEvaluators, addEvaluator, updateEvaluator, deleteEvaluator, setGlobal, forkEvaluator,
  } = useEvaluatorsStore();
  const { addTask, completeTask } = useTaskQueueStore.getState();

  // Sync evaluator runs from session
  useEffect(() => {
    setEvaluatorRuns(session?.evaluatorRuns || []);
  }, [session?.evaluatorRuns]);

  useEffect(() => {
    if (!isLoaded || currentAppId !== 'kaira-bot') {
      loadAppEvaluators('kaira-bot');
    }
  }, [isLoaded, currentAppId, loadAppEvaluators]);

  const context: EvaluatorContext = {
    appId: 'kaira-bot',
    entityId: undefined,
    evaluatorRuns,
  };

  const handleSave = async (evaluator: EvaluatorDefinition) => {
    if (editingEvaluator) {
      await updateEvaluator(evaluator);
      notificationService.success('Evaluator updated');
    } else {
      await addEvaluator(evaluator);
      notificationService.success('Evaluator created');
    }
    setEditingEvaluator(undefined);
  };

  const handleRun = async (evaluator: EvaluatorDefinition) => {
    if (!session) {
      notificationService.error('No active chat session. Start a conversation first.', 'No Session');
      return;
    }

    const llm = useLLMSettingsStore.getState();
    if (!llm.apiKey) {
      notificationService.error('Please configure your API key in Settings', 'API Key Required');
      return;
    }

    // Create processing run
    const processingRun: EvaluatorRun = {
      id: crypto.randomUUID(),
      evaluatorId: evaluator.id,
      sessionId: session.id,
      status: 'processing',
      startedAt: new Date(),
    };

    // Update local state
    const updatedRuns = [...evaluatorRuns];
    const existingIndex = updatedRuns.findIndex(r => r.evaluatorId === evaluator.id);
    if (existingIndex >= 0) {
      updatedRuns[existingIndex] = processingRun;
    } else {
      updatedRuns.push(processingRun);
    }
    setEvaluatorRuns(updatedRuns);

    // Save to session
    await chatSessionsRepository.update('kaira-bot', session.id, { evaluatorRuns: updatedRuns });

    const taskId = addTask({ type: 'evaluator', listingId: session.id });
    notificationService.info(`Running ${evaluator.name}...`, 'Evaluator Started');

    const abortController = new AbortController();
    abortControllersRef.current.set(evaluator.id, abortController);

    try {
      const completedRun = await evaluatorExecutor.executeForSession(evaluator, session, {
        abortSignal: abortController.signal,
      });

      abortControllersRef.current.delete(evaluator.id);

      // Refresh session to get backend-updated evaluator_runs
      const refreshed = await chatSessionsRepository.getById('kaira-bot', session.id);
      if (refreshed?.evaluatorRuns) {
        setEvaluatorRuns(refreshed.evaluatorRuns);
      } else {
        // Fallback: update local
        const finalRuns = [...evaluatorRuns];
        const idx = finalRuns.findIndex(r => r.evaluatorId === evaluator.id);
        if (idx >= 0) finalRuns[idx] = completedRun;
        else finalRuns.push(completedRun);
        setEvaluatorRuns(finalRuns);
      }

      completeTask(taskId, completedRun.status === 'completed' ? 'success' : 'error');

      if (completedRun.status === 'completed') {
        notificationService.success(`${evaluator.name} completed successfully`, 'Evaluator Complete');
      } else {
        notificationService.error(completedRun.error || 'Evaluator failed', `${evaluator.name} Failed`);
      }
    } catch (error) {
      abortControllersRef.current.delete(evaluator.id);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const failedRun: EvaluatorRun = {
        ...processingRun,
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
      };

      const errorRuns = [...evaluatorRuns];
      const errorIndex = errorRuns.findIndex(r => r.evaluatorId === evaluator.id);
      if (errorIndex >= 0) errorRuns[errorIndex] = failedRun;
      else errorRuns.push(failedRun);
      setEvaluatorRuns(errorRuns);

      await chatSessionsRepository.update('kaira-bot', session.id, { evaluatorRuns: errorRuns });

      completeTask(taskId, 'error');
      notificationService.error(errorMessage, `${evaluator.name} Failed`);
    }
  };

  const handleEdit = (evaluator: EvaluatorDefinition) => {
    setEditingEvaluator(evaluator);
    setIsModalOpen(true);
  };

  const handleCancel = async (evaluatorId: string) => {
    const abortController = abortControllersRef.current.get(evaluatorId);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(evaluatorId);
      notificationService.info('Evaluator cancelled');
    }
  };

  const handleDelete = async (evaluatorId: string) => {
    setEvaluatorToDelete(evaluatorId);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (evaluatorToDelete) {
      await deleteEvaluator(evaluatorToDelete);
      notificationService.success('Evaluator deleted');
      setDeleteConfirmOpen(false);
      setEvaluatorToDelete(null);
    }
  };

  const handleToggleHeader = async (evaluatorId: string, showInHeader: boolean) => {
    const evaluator = evaluators.find(e => e.id === evaluatorId);
    if (!evaluator) return;
    await updateEvaluator({ ...evaluator, showInHeader, updatedAt: new Date() });
    notificationService.success(showInHeader ? 'Evaluator added to header' : 'Evaluator removed from header');
  };

  const handleToggleGlobal = async (evaluatorId: string, isGlobal: boolean) => {
    await setGlobal(evaluatorId, isGlobal);
    notificationService.success(isGlobal ? 'Evaluator added to Registry' : 'Evaluator removed from Registry');
  };

  const handleFork = async (sourceId: string) => {
    // For kaira-bot, fork creates an app-level copy (no listing_id)
    const forked = await forkEvaluator(sourceId, '');
    notificationService.success(`Forked evaluator: ${forked.name}`);
  };

  const getLatestRun = (evaluatorId: string): EvaluatorRun | undefined => {
    return evaluatorRuns.find(r => r.evaluatorId === evaluatorId);
  };

  const noSession = !session;

  return (
    <div className="space-y-4 p-6 min-h-full flex flex-col">
      {noSession && (
        <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 text-[13px] text-[var(--color-warning)]">
          Start a chat session first, then run evaluators against the conversation.
        </div>
      )}

      {evaluators.length === 0 ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <EmptyState
            icon={BarChart3}
            title="No evaluators yet"
            description="Create an evaluator to analyze chat conversations using custom prompts and LLM evaluation."
            className="w-full max-w-md"
          >
          <div className="relative mt-1">
            <Button onClick={() => setShowAddMenu(!showAddMenu)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Evaluator
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>

            {showAddMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                <div className="absolute left-1/2 -translate-x-1/2 mt-1 w-48 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => { setIsModalOpen(true); setShowAddMenu(false); }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => { setShowRegistryPicker(true); setShowAddMenu(false); }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                  >
                    Add from Registry
                  </button>
                </div>
              </>
            )}
          </div>
          </EmptyState>
        </div>
      ) : (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Evaluators ({evaluators.length})</h3>
            <div className="relative">
              <Button onClick={() => setShowAddMenu(!showAddMenu)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Evaluator
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>

              {showAddMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
                  <div className="absolute right-0 mt-1 w-48 bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-lg z-20 py-1">
                    <button
                      onClick={() => { setIsModalOpen(true); setShowAddMenu(false); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                    >
                      Create New
                    </button>
                    <button
                      onClick={() => { setShowRegistryPicker(true); setShowAddMenu(false); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--interactive-secondary)] text-[var(--text-primary)]"
                    >
                      Add from Registry
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {evaluators.map(evaluator => (
              <EvaluatorCard
                key={evaluator.id}
                evaluator={evaluator}
                latestRun={getLatestRun(evaluator.id)}
                onRun={handleRun}
                onCancel={handleCancel}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleHeader={handleToggleHeader}
                onToggleGlobal={handleToggleGlobal}
              />
            ))}
          </div>
        </div>
      )}

      <CreateEvaluatorOverlay
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingEvaluator(undefined);
        }}
        onSave={handleSave}
        context={context}
        editEvaluator={editingEvaluator}
      />

      <EvaluatorRegistryPicker
        isOpen={showRegistryPicker}
        onClose={() => setShowRegistryPicker(false)}
        appId="kaira-bot"
        onFork={handleFork}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => { setDeleteConfirmOpen(false); setEvaluatorToDelete(null); }}
        onConfirm={handleConfirmDelete}
        title="Delete Evaluator"
        description="Are you sure you want to delete this evaluator? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
