/**
 * KairaBotEvaluatorsView — evaluators tab for kaira-bot.
 *
 * Same look/feel as the voice-rx EvaluatorsView but adapted for
 * kaira-bot app-level evaluators (no listing, uses chat sessions).
 */

import { useState, useEffect } from 'react';
import { Plus, ChevronDown, BarChart3 } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState } from '@/components/ui';
import { CreateEvaluatorOverlay } from '@/features/evals/components/CreateEvaluatorOverlay';
import { EvaluatorCard } from '@/features/evals/components/EvaluatorCard';
import { EvaluatorRegistryPicker } from '@/features/evals/components/EvaluatorRegistryPicker';
import { useEvaluatorsStore } from '@/stores';
import { useEvaluatorRunner } from '@/features/evals/hooks/useEvaluatorRunner';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { notificationService } from '@/services/notifications';
import type { KairaChatSession, KairaChatMessage, EvaluatorDefinition, EvaluatorContext } from '@/types';

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

  const {
    evaluators, isLoaded, currentAppId,
    loadAppEvaluators, addEvaluator, updateEvaluator, deleteEvaluator, setGlobal, forkEvaluator,
  } = useEvaluatorsStore();

  const runner = useEvaluatorRunner({
    entityId: session?.id || '',
    appId: 'kaira-bot',
    sessionId: session?.id,
    execute: (evaluator, signal, onJobCreated) => {
      if (!session) throw new Error('No session');
      return evaluatorExecutor.executeForSession(evaluator, session, { abortSignal: signal, onJobCreated }).then(() => {});
    },
  });

  useEffect(() => {
    if (!isLoaded || currentAppId !== 'kaira-bot') {
      loadAppEvaluators('kaira-bot');
    }
  }, [isLoaded, currentAppId, loadAppEvaluators]);

  const context: EvaluatorContext = {
    appId: 'kaira-bot',
    entityId: undefined,
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
    await runner.handleRun(evaluator);
  };

  const handleEdit = (evaluator: EvaluatorDefinition) => {
    setEditingEvaluator(evaluator);
    setIsModalOpen(true);
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
                latestRun={runner.getLatestRun(evaluator.id)}
                onRun={handleRun}
                onCancel={runner.handleCancel}
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
