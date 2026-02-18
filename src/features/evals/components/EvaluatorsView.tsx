import { useState, useEffect } from 'react';
import { Plus, ChevronDown, BarChart3 } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Skeleton } from '@/components/ui';
import { CreateEvaluatorOverlay } from './CreateEvaluatorOverlay';
import { EvaluatorCard } from './EvaluatorCard';
import { EvaluatorRegistryPicker } from './EvaluatorRegistryPicker';
import { useEvaluatorsStore } from '@/stores';
import { useEvaluatorRunner } from '@/features/evals/hooks/useEvaluatorRunner';
import { evaluatorExecutor } from '@/services/evaluators/evaluatorExecutor';
import { notificationService } from '@/services/notifications';
import type { Listing, EvaluatorDefinition } from '@/types';

interface EvaluatorsViewProps {
  listing: Listing;
  onUpdate?: (listing: Listing) => void;
}

export function EvaluatorsView({ listing, onUpdate: _onUpdate }: EvaluatorsViewProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEvaluator, setEditingEvaluator] = useState<EvaluatorDefinition | undefined>();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showRegistryPicker, setShowRegistryPicker] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<string | null>(null);

  const { evaluators, isLoaded, currentListingId, loadEvaluators, addEvaluator, updateEvaluator, deleteEvaluator, setGlobal, forkEvaluator } = useEvaluatorsStore();

  const runner = useEvaluatorRunner({
    entityId: listing.id,
    appId: listing.appId,
    listingId: listing.id,
    execute: (evaluator, signal, onJobCreated) =>
      evaluatorExecutor.execute(evaluator, listing, { abortSignal: signal, onJobCreated }).then(() => {}),
  });

  useEffect(() => {
    if (!isLoaded || currentListingId !== listing.id) {
      loadEvaluators(listing.appId, listing.id);
    }
  }, [isLoaded, currentListingId, listing.appId, listing.id, loadEvaluators]);

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

  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setEvaluatorToDelete(null);
  };

  const handleToggleHeader = async (evaluatorId: string, showInHeader: boolean) => {
    const evaluator = evaluators.find(e => e.id === evaluatorId);
    if (!evaluator) return;

    const updated: EvaluatorDefinition = {
      ...evaluator,
      showInHeader,
      updatedAt: new Date(),
    };

    await updateEvaluator(updated);
    notificationService.success(
      showInHeader ? 'Evaluator added to header' : 'Evaluator removed from header'
    );
  };

  const handleToggleGlobal = async (evaluatorId: string, isGlobal: boolean) => {
    await setGlobal(evaluatorId, isGlobal);
    notificationService.success(
      isGlobal
        ? 'Evaluator added to Registry'
        : 'Evaluator removed from Registry'
    );
  };

  const handleFork = async (sourceId: string) => {
    const forked = await forkEvaluator(sourceId, listing.id);
    notificationService.success(`Forked evaluator: ${forked.name}`);
  };

  return (
    <div className="space-y-4 p-6 min-h-full flex flex-col">
      {!isLoaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : evaluators.length === 0 ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <EmptyState
            icon={BarChart3}
            title="No evaluators yet"
            description="Add an evaluator to measure specific dimensions of quality like recall, factual integrity, or custom metrics."
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

          {/* Grid of evaluator cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {evaluators.map(evaluator => (
              <EvaluatorCard
                key={evaluator.id}
                evaluator={evaluator}
                listing={listing}
                latestRun={runner.getLatestRun(evaluator.id)}
                onRun={runner.handleRun}
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
        listing={listing}
        editEvaluator={editingEvaluator}
      />

      <EvaluatorRegistryPicker
        isOpen={showRegistryPicker}
        onClose={() => setShowRegistryPicker(false)}
        listing={listing}
        onFork={handleFork}
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Evaluator"
        description="Are you sure you want to delete this evaluator? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
